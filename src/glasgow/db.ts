// Live lecture polling: the D1 side, with its tables (created on first use).
import { checkAnswer, DEVICE_RE, isBlocked, json, fail, numberResults, rateKey, textResults, tokenMatches } from './core';
import { findQuestion, findSet, type QuestionSet } from './sets';

export interface GlasgowEnv { DB: D1Database; TOKEN_SECRET?: string; GLASGOW_PRESENTER_TOKEN?: string }

/** Answers allowed per address per minute, across all devices behind it (a lecture theatre on one network). */
export const PER_ADDRESS_PER_MINUTE = 120;
/** Answers (including changes) allowed per device per minute. */
export const PER_DEVICE_PER_MINUTE = 12;

const now = () => new Date().toISOString();

/**
 * The tables, created on first use (idempotent), so the feature needs no step in the deploy workflow.
 * Privacy: no personal data. A device is a random id the phone's browser makes up; answers are deleted at
 * delete_after (30 days after the lecture) by the cron Worker. glasgow_rate holds a keyed hash of the address,
 * never the address, for rate limiting only, and is cleared after an hour.
 */
const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS glasgow_state (set_id TEXT PRIMARY KEY, current TEXT, changed_at TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS glasgow_answers (id INTEGER PRIMARY KEY, set_id TEXT NOT NULL, q TEXT NOT NULL, device TEXT NOT NULL,
		value_num REAL, value_text TEXT, blocked INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delete_after TEXT NOT NULL, UNIQUE (set_id, q, device))`,
	`CREATE INDEX IF NOT EXISTS glasgow_answers_q ON glasgow_answers (set_id, q, updated_at)`,
	`CREATE INDEX IF NOT EXISTS glasgow_answers_expiry ON glasgow_answers (delete_after)`,
	`CREATE TABLE IF NOT EXISTS glasgow_rate (key TEXT NOT NULL, minute INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (key, minute))`,
];
let ready: Promise<unknown> | null = null;
/** Once per Worker instance; retried if it failed. */
export function ensureSchema(db: D1Database) {
	if (!ready) ready = db.batch(SCHEMA.map((q) => db.prepare(q))).catch((e) => { ready = null; throw e; });
	return ready;
}

async function current(env: GlasgowEnv, set: QuestionSet) {
	const row = await env.DB.prepare('SELECT current, changed_at FROM glasgow_state WHERE set_id = ?').bind(set.id).first<{ current: string | null; changed_at: string }>();
	return { current: row?.current ?? null, changedAt: row?.changed_at ?? null };
}

export async function getState(env: GlasgowEnv, setId: string | null) {
	await ensureSchema(env.DB);
	const set = findSet(setId);
	if (!set) return fail(404, 'No such question set.');
	const c = await current(env, set);
	return json({ set: set.id, title: set.title, current: c.current, changedAt: c.changedAt, pollSeconds: set.pollSeconds,
		questions: set.questions.map(({ bins: _b, ...q }: any) => q) });
}

export async function getResults(env: GlasgowEnv, setId: string | null, qId: string | null) {
	await ensureSchema(env.DB);
	const set = findSet(setId);
	if (!set) return fail(404, 'No such question set.');
	const q = findQuestion(set, qId);
	if (!q) return fail(404, 'No such question.');
	const base = { set: set.id, q: q.id, updatedAt: now() };
	if (q.type === 'number') {
		const rows = (await env.DB.prepare('SELECT value_num FROM glasgow_answers WHERE set_id = ? AND q = ? AND value_num IS NOT NULL').bind(set.id, q.id).all<{ value_num: number }>()).results;
		return json({ ...base, ...numberResults(q, rows.map((r: { value_num: number }) => r.value_num)) });
	}
	const shown = "set_id = ? AND q = ? AND value_text IS NOT NULL AND blocked = 0 AND hidden = 0";
	const rows = (await env.DB.prepare(`SELECT id, value_text AS text, updated_at AS at FROM glasgow_answers WHERE ${shown} ORDER BY updated_at DESC, id DESC LIMIT 30`).bind(set.id, q.id).all<{ id: number; text: string; at: string }>()).results;
	const count = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM glasgow_answers WHERE ${shown}`).bind(set.id, q.id).first<{ n: number }>())?.n ?? 0;
	return json({ ...base, ...textResults(q, rows, count) });
}

/** Counts one hit against a key in the current minute; true while under the limit. */
async function underLimit(env: GlasgowEnv, key: string, limit: number) {
	const minute = Math.floor(Date.now() / 60000);
	const row = await env.DB.prepare('INSERT INTO glasgow_rate (key, minute, n) VALUES (?, ?, 1) ON CONFLICT (key, minute) DO UPDATE SET n = n + 1 RETURNING n').bind(key, minute).first<{ n: number }>();
	return (row?.n ?? 0) <= limit;
}

export async function postAnswer(env: GlasgowEnv, request: Request) {
	await ensureSchema(env.DB);
	let body: any;
	try { body = await request.json(); } catch { return fail(400, 'Expected JSON.'); }
	const set = findSet(typeof body?.set === 'string' ? body.set : null);
	if (!set) return fail(404, 'No such question set.');
	const q = findQuestion(set, typeof body?.q === 'string' ? body.q : null);
	if (!q) return fail(404, 'No such question.');
	const device = typeof body?.device === 'string' ? body.device : '';
	if (!DEVICE_RE.test(device)) return fail(400, 'Missing or malformed device id.');
	const checked = checkAnswer(q, body?.value);
	if (!checked.ok) return fail(400, checked.error);
	if (new Date(set.deleteAfter).getTime() <= Date.now()) return fail(410, 'This lecture has finished.');
	const c = await current(env, set);
	if (c.current !== q.id) return fail(409, 'That question has closed.');
	const ip = request.headers.get('cf-connecting-ip') || 'unknown';
	const addr = await rateKey(ip, env.TOKEN_SECRET || '');
	if (!(await underLimit(env, 'a:' + addr, PER_ADDRESS_PER_MINUTE)) || !(await underLimit(env, 'd:' + device, PER_DEVICE_PER_MINUTE))) return fail(429, 'Too many answers just now: please wait a minute.');
	const blocked = checked.text !== null && isBlocked(checked.text) ? 1 : 0;
	const t = now();
	await env.DB.prepare(`INSERT INTO glasgow_answers (set_id, q, device, value_num, value_text, blocked, hidden, created_at, updated_at, delete_after)
		VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
		ON CONFLICT (set_id, q, device) DO UPDATE SET value_num = excluded.value_num, value_text = excluded.value_text, blocked = excluded.blocked, hidden = 0, updated_at = excluded.updated_at`)
		.bind(set.id, q.id, device, checked.num, checked.text, blocked, t, t, set.deleteAfter).run();
	return json({ ok: true, q: q.id, value: checked.num ?? checked.text });
}

function presenter(env: GlasgowEnv, request: Request) {
	if (!env.GLASGOW_PRESENTER_TOKEN) return fail(503, 'The presenter token is not set up on the server.');
	if (!tokenMatches(request.headers.get('x-presenter-token'), env.GLASGOW_PRESENTER_TOKEN)) return fail(401, 'Wrong presenter token.');
	return null;
}

export async function postCurrent(env: GlasgowEnv, request: Request) {
	await ensureSchema(env.DB);
	const denied = presenter(env, request);
	if (denied) return denied;
	let body: any;
	try { body = await request.json(); } catch { return fail(400, 'Expected JSON.'); }
	const set = findSet(typeof body?.set === 'string' ? body.set : null);
	if (!set) return fail(404, 'No such question set.');
	const q = body?.q === null || body?.q === '' ? null : findQuestion(set, typeof body?.q === 'string' ? body.q : null);
	if (q === undefined) return fail(404, 'No such question.');
	await env.DB.prepare('INSERT INTO glasgow_state (set_id, current, changed_at) VALUES (?, ?, ?) ON CONFLICT (set_id) DO UPDATE SET current = excluded.current, changed_at = excluded.changed_at')
		.bind(set.id, q ? q.id : null, now()).run();
	return json({ ok: true, current: q ? q.id : null });
}

export async function postHide(env: GlasgowEnv, request: Request) {
	await ensureSchema(env.DB);
	const denied = presenter(env, request);
	if (denied) return denied;
	let body: any;
	try { body = await request.json(); } catch { return fail(400, 'Expected JSON.'); }
	const set = findSet(typeof body?.set === 'string' ? body.set : null);
	if (!set) return fail(404, 'No such question set.');
	const id = Number(body?.id);
	if (!Number.isInteger(id) || id <= 0) return fail(400, 'Missing answer id.');
	const r = await env.DB.prepare('UPDATE glasgow_answers SET hidden = ? WHERE id = ? AND set_id = ? AND (? IS NULL OR q = ?)')
		.bind(body?.hidden === false ? 0 : 1, id, set.id, body?.q ?? null, body?.q ?? null).run();
	if (!r.meta.changes) return fail(404, 'No such answer.');
	return json({ ok: true });
}

/** Retention: answers after their lecture's delete date, and rate-limit counts after an hour. Run by the cron Worker. */
export async function purge(env: { DB: D1Database }) {
	await ensureSchema(env.DB);
	const a = await env.DB.prepare('DELETE FROM glasgow_answers WHERE delete_after <= ?').bind(now()).run();
	const r = await env.DB.prepare('DELETE FROM glasgow_rate WHERE minute < ?').bind(Math.floor(Date.now() / 60000) - 60).run();
	return { answers: a.meta.changes, rate: r.meta.changes };
}
