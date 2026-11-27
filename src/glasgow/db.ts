// Live lecture polling: the D1 side, with its tables (created on first use).
import { checkAnswer, checkTeam, choicePicks, choiceResults, DEVICE_RE, isBlocked, json, fail, numberResults, rateKey, snapshotCounts, textResults, tokenMatches } from './core';
import { findSet, type Question, type QuestionSet } from './sets';
import { checkQuestion, publicQuestion, seedRows } from './questions';

export interface GlasgowEnv { DB: D1Database; TOKEN_SECRET?: string; GLASGOW_PRESENTER_TOKEN?: string }

/** Answers allowed per address per minute, across all devices behind it (a lecture theatre on one network). */
export const PER_ADDRESS_PER_MINUTE = 120;
/** Answers (including changes) allowed per device per minute. */
export const PER_DEVICE_PER_MINUTE = 30;
/** Shown answers to a text question, at most: enough for any lecture theatre's word cloud. */
const MAX_TEXTS = 2000;
/** Seconds between answers from one phone to a word-cloud question. */
const CLOUD_GAP_SECONDS = 2;

export const now = () => new Date().toISOString();

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
	// Hands up and audience questions (src/glasgow/audience.ts). Every question and every hand going up or down is kept,
	// with its device id and time, until delete_after: a record for the presenter, never shown publicly.
	`CREATE TABLE IF NOT EXISTS glasgow_slide (set_id TEXT PRIMARY KEY, n INTEGER, key TEXT, at TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS glasgow_questions (id INTEGER PRIMARY KEY, set_id TEXT NOT NULL, device TEXT NOT NULL, text TEXT NOT NULL,
		at TEXT NOT NULL, slide_n INTEGER, slide_key TEXT, answered_at TEXT, delete_after TEXT NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS glasgow_questions_set ON glasgow_questions (set_id, id)`,
	`CREATE INDEX IF NOT EXISTS glasgow_questions_device ON glasgow_questions (device, at)`,
	`CREATE TABLE IF NOT EXISTS glasgow_hands (set_id TEXT NOT NULL, device TEXT NOT NULL, up INTEGER NOT NULL, since TEXT NOT NULL,
		seen_at TEXT NOT NULL, delete_after TEXT NOT NULL, PRIMARY KEY (set_id, device))`,
	// "Clear" for questions keeps the record: /audience lists only questions after this id.
	`CREATE TABLE IF NOT EXISTS glasgow_clears (set_id TEXT PRIMARY KEY, questions_after INTEGER NOT NULL, at TEXT NOT NULL)`,
	// The questions, editable from the slides; seeded once per set from src/glasgow/sets.ts (glasgow_seeded).
	`CREATE TABLE IF NOT EXISTS glasgow_qdefs (set_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, def TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (set_id, id))`,
	`CREATE TABLE IF NOT EXISTS glasgow_seeded (set_id TEXT PRIMARY KEY, at TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS glasgow_hand_events (id INTEGER PRIMARY KEY, set_id TEXT NOT NULL, device TEXT NOT NULL, up INTEGER NOT NULL,
		at TEXT NOT NULL, delete_after TEXT NOT NULL)`,
	// Teams (optional): the team name a phone sent with an answer, kept beside the answer rather than in a new column of
	// glasgow_answers, so it needs no migration. Deleted with the answer, or at delete_after.
	`CREATE TABLE IF NOT EXISTS glasgow_answer_teams (answer_id INTEGER PRIMARY KEY, team TEXT NOT NULL, delete_after TEXT NOT NULL)`,
	// Frozen polls (27 Nov, Martin: "freeze those polls and change clear all so it doesn't wipe frozen polls"): a frozen
	// question takes no answers, cannot be made current, and no clear or delete touches its answers until it is
	// explicitly unfrozen. counts: restored totals (a JSON list per option) that /results shows instead of the answers,
	// for a poll whose answers were wiped before freezing existed (eventsandeye/migrations/0013_glasgow_frozen_polls.sql,
	// which creates this same table). Totals only: no device, nothing personal, so it has no delete_after.
	`CREATE TABLE IF NOT EXISTS glasgow_frozen (set_id TEXT NOT NULL, q TEXT NOT NULL, at TEXT NOT NULL, counts TEXT, PRIMARY KEY (set_id, q))`,
];
const ready = new WeakMap<D1Database, Promise<unknown>>();
/** Once per Worker instance (per database binding); retried if it failed. */
export function ensureSchema(db: D1Database) {
	let p = ready.get(db);
	if (!p) { p = db.batch(SCHEMA.map((q) => db.prepare(q))).catch((e) => { ready.delete(db); throw e; }); ready.set(db, p); }
	return p;
}

/** The set's frozen questions: id -> restored counts (null: none, the answers count). */
export async function frozenOf(env: GlasgowEnv, setId: string) {
	const rows = (await env.DB.prepare('SELECT q, counts FROM glasgow_frozen WHERE set_id = ?').bind(setId).all<{ q: string; counts: string | null }>()).results;
	return new Map(rows.map((r: { q: string; counts: string | null }) => [r.q, r.counts]));
}
export async function isFrozen(env: GlasgowEnv, setId: string, q: string) {
	return !!(await env.DB.prepare('SELECT 1 AS y FROM glasgow_frozen WHERE set_id = ? AND q = ?').bind(setId, q).first());
}
/** The refusal for anything that would change a frozen poll's answers or definition. */
export const frozenFail = () => fail(409, 'That poll is frozen: its answers are kept. Unfreeze it first (POST /api/glasgow/unfreeze).');

/** The set's questions, in order: seeded from the config the first time, then whatever the presenter has made them. */
const seededIn = new WeakMap<D1Database, Set<string>>();
export async function getQuestions(env: GlasgowEnv, set: QuestionSet): Promise<Question[]> {
	// Checked once per Worker instance, so the phones' polling stays read-only.
	let seededHere = seededIn.get(env.DB);
	if (!seededHere) { seededHere = new Set(); seededIn.set(env.DB, seededHere); }
	if (!seededHere.has(set.id)) {
		const seeded = await env.DB.prepare('SELECT 1 AS y FROM glasgow_seeded WHERE set_id = ?').bind(set.id).first();
		if (!seeded) {
			// One transaction, so nobody sees the set half-seeded; repeating it (two instances at once) changes nothing.
			const t = now();
			await env.DB.batch([
				...seedRows(set).map((r) => env.DB.prepare('INSERT OR IGNORE INTO glasgow_qdefs (set_id, id, ord, def, updated_at) VALUES (?, ?, ?, ?, ?)').bind(set.id, r.id, r.order, r.def, t)),
				env.DB.prepare('INSERT OR IGNORE INTO glasgow_seeded (set_id, at) VALUES (?, ?)').bind(set.id, t),
			]);
		}
		seededHere.add(set.id);
	}
	const rows = (await env.DB.prepare('SELECT def FROM glasgow_qdefs WHERE set_id = ? ORDER BY ord, id').bind(set.id).all<{ def: string }>()).results;
	return rows.map((r: { def: string }) => JSON.parse(r.def) as Question);
}
export async function getQuestion(env: GlasgowEnv, set: QuestionSet, id: unknown) {
	return typeof id === 'string' && id ? (await getQuestions(env, set)).find((q) => q.id === id) : undefined;
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
	const frozen = await frozenOf(env, set.id);
	return json({ set: set.id, title: set.title, current: c.current, changedAt: c.changedAt, pollSeconds: set.pollSeconds,
		questions: (await getQuestions(env, set)).map((q) => (frozen.has(q.id) ? { ...publicQuestion(q), frozen: true } : publicQuestion(q))) });
}

export async function getResults(env: GlasgowEnv, setId: string | null, qId: string | null) {
	await ensureSchema(env.DB);
	const set = findSet(setId);
	if (!set) return fail(404, 'No such question set.');
	const q = await getQuestion(env, set, qId);
	if (!q) return fail(404, 'No such question.');
	const frozen = await frozenOf(env, set.id);
	const base = { set: set.id, q: q.id, updatedAt: now(), ...(frozen.has(q.id) ? { frozen: true } : {}) };
	// A frozen poll with restored totals shows those, with no individual answers.
	const restored = frozen.has(q.id) ? snapshotCounts(q, frozen.get(q.id)) : null;
	if (restored && q.type === 'choice') return json({ ...base, ...choiceResults(q, restored.flatMap((n, i) => Array<number>(n).fill(i))), picks: [], restored: true });
	if (q.type === 'number' || q.type === 'choice') {
		const rows = (await env.DB.prepare('SELECT value_num FROM glasgow_answers WHERE set_id = ? AND q = ? AND value_num IS NOT NULL').bind(set.id, q.id).all<{ value_num: number }>()).results;
		const values = rows.map((r: { value_num: number }) => r.value_num);
		if (q.type === 'number') return json({ ...base, ...numberResults(q, values) });
		// Also each answer with its time and team (additive: "picks"), so a quiz can see which team chose what first.
		const pickRows = (await env.DB.prepare(`SELECT a.id, a.value_num, a.updated_at AS at, t.team FROM glasgow_answers a
			LEFT JOIN glasgow_answer_teams t ON t.answer_id = a.id
			WHERE a.set_id = ? AND a.q = ? AND a.value_num IS NOT NULL AND a.blocked = 0 AND a.hidden = 0 ORDER BY a.updated_at ASC, a.id ASC LIMIT ?`).bind(set.id, q.id, MAX_TEXTS).all<{ id: number; value_num: number; at: string; team: string | null }>()).results;
		return json({ ...base, ...choiceResults(q, values), picks: choicePicks(q, pickRows) });
	}
	const rows = (await env.DB.prepare(`SELECT a.id, a.value_text AS text, a.updated_at AS at, t.team FROM glasgow_answers a
		LEFT JOIN glasgow_answer_teams t ON t.answer_id = a.id
		WHERE a.set_id = ? AND a.q = ? AND a.value_text IS NOT NULL AND a.blocked = 0 AND a.hidden = 0 ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`).bind(set.id, q.id, MAX_TEXTS).all<{ id: number; text: string; at: string; team: string | null }>()).results;
	return json({ ...base, ...textResults(q, rows) });
}

/** Counts one hit against a key in the current minute; true while under the limit. */
export async function underLimit(env: GlasgowEnv, key: string, limit: number) {
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
	const q = await getQuestion(env, set, body?.q);
	if (!q) return fail(404, 'No such question.');
	const device = typeof body?.device === 'string' ? body.device : '';
	if (!DEVICE_RE.test(device)) return fail(400, 'Missing or malformed device id.');
	const checked = checkAnswer(q, body?.value);
	if (!checked.ok) return fail(400, checked.error);
	if (new Date(set.deleteAfter).getTime() <= Date.now()) return fail(410, 'This lecture has finished.');
	const c = await current(env, set);
	if (c.current !== q.id || (await isFrozen(env, set.id, q.id))) return fail(409, 'That question has closed.');
	const ip = request.headers.get('cf-connecting-ip') || 'unknown';
	const addr = await rateKey(ip, env.TOKEN_SECRET || '');
	if (!(await underLimit(env, 'a:' + addr, PER_ADDRESS_PER_MINUTE)) || !(await underLimit(env, 'd:' + device, PER_DEVICE_PER_MINUTE))) return fail(429, 'Too many answers just now: please wait a minute.');
	const blocked = checked.text !== null && isBlocked(checked.text) ? 1 : 0;
	const team = checkTeam(body?.team);
	const t = now();
	if (q.type === 'text' && q.multiple) {
		// Each send is a new row, stored as "<device>#<time>" (a device id never contains "#"), so the one-per-device
		// rule of the table still holds for every other question. Counted by the range of ids that start "<device>#".
		const mine = await env.DB.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM glasgow_answers WHERE set_id = ? AND q = ? AND device >= ? AND device < ?')
			.bind(set.id, q.id, device + '#', device + '$').first<{ n: number; last: string | null }>();
		if (mine?.last && Date.now() - Date.parse(mine.last) < CLOUD_GAP_SECONDS * 1000) return fail(429, 'Wait a moment before adding another.');
		if ((mine?.n ?? 0) >= (q.maxPerDevice ?? 30)) return fail(429, "That's the most answers one phone can add.");
		const row = await env.DB.prepare(`INSERT INTO glasgow_answers (set_id, q, device, value_num, value_text, blocked, hidden, created_at, updated_at, delete_after)
			VALUES (?, ?, ?, NULL, ?, ?, 0, ?, ?, ?) RETURNING id`).bind(set.id, q.id, `${device}#${Date.now()}${Math.floor(Math.random() * 1000)}`, checked.text, blocked, t, t, set.deleteAfter).first<{ id: number }>();
		if (row?.id) await setTeam(env, row.id, team, set.deleteAfter);
		return json({ ok: true, q: q.id, value: checked.text, id: row?.id ?? null, ...(team ? { team } : {}) });
	}
	await env.DB.prepare(`INSERT INTO glasgow_answers (set_id, q, device, value_num, value_text, blocked, hidden, created_at, updated_at, delete_after)
		VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
		ON CONFLICT (set_id, q, device) DO UPDATE SET value_num = excluded.value_num, value_text = excluded.value_text, blocked = excluded.blocked, hidden = 0, updated_at = excluded.updated_at`)
		.bind(set.id, q.id, device, checked.num, checked.text, blocked, t, t, set.deleteAfter).run();
	const row = await env.DB.prepare('SELECT id FROM glasgow_answers WHERE set_id = ? AND q = ? AND device = ?').bind(set.id, q.id, device).first<{ id: number }>();
	if (row?.id) await setTeam(env, row.id, team, set.deleteAfter);
	return json({ ok: true, q: q.id, value: checked.num ?? checked.text, id: row?.id ?? null, ...(team ? { team } : {}) });
}

/** The answer's team: replaced by the latest send, and removed when an answer is changed from a phone with no team. */
async function setTeam(env: GlasgowEnv, answerId: number, team: string | null, deleteAfter: string) {
	if (team) await env.DB.prepare('INSERT INTO glasgow_answer_teams (answer_id, team, delete_after) VALUES (?, ?, ?) ON CONFLICT (answer_id) DO UPDATE SET team = excluded.team')
		.bind(answerId, team, deleteAfter).run();
	else await env.DB.prepare('DELETE FROM glasgow_answer_teams WHERE answer_id = ?').bind(answerId).run();
}

export function presenter(env: GlasgowEnv, request: Request) {
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
	const q = body?.q === null || body?.q === '' ? null : await getQuestion(env, set, body?.q);
	if (q === undefined) return fail(404, 'No such question.');
	if (q && (await isFrozen(env, set.id, q.id))) return fail(409, 'That poll is frozen: it cannot be opened again. Unfreeze it first (POST /api/glasgow/unfreeze).');
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
	const t = now();
	const audience = await env.DB.batch(['glasgow_questions', 'glasgow_hands', 'glasgow_hand_events', 'glasgow_answer_teams'].map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE delete_after <= ?`).bind(t)));
	return { answers: a.meta.changes, rate: r.meta.changes, audience: audience.reduce((n, x) => n + (x.meta.changes ?? 0), 0) };
}

/** PUT /questions/<id> (presenter): create or replace a question. Says how many answers it already has. */
export async function putQuestion(env: GlasgowEnv, request: Request, id: string) {
	const denied = presenter(env, request);
	if (denied) return denied;
	await ensureSchema(env.DB);
	let body: any;
	try { body = await request.json(); } catch { return fail(400, 'Expected JSON.'); }
	const set = findSet(typeof body?.set === 'string' ? body.set : new URL(request.url).searchParams.get('set'));
	if (!set) return fail(404, 'No such question set.');
	const checked = checkQuestion(id, body);
	if (!checked.ok) return fail(400, checked.error);
	const existing = await getQuestions(env, set);
	const was = await env.DB.prepare('SELECT ord, def FROM glasgow_qdefs WHERE set_id = ? AND id = ?').bind(set.id, id).first<{ ord: number; def: string }>();
	// A frozen poll keeps its definition (its totals belong to those options); sending the same one again is harmless.
	if (was && was.def !== JSON.stringify(checked.question) && (await isFrozen(env, set.id, id))) return frozenFail();
	const ord = checked.order ?? was?.ord ?? (existing.length + 1) * 10 + 1000;
	await env.DB.prepare(`INSERT INTO glasgow_qdefs (set_id, id, ord, def, updated_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (set_id, id) DO UPDATE SET ord = excluded.ord, def = excluded.def, updated_at = excluded.updated_at`).bind(set.id, id, ord, JSON.stringify(checked.question), now()).run();
	const answers = (await env.DB.prepare('SELECT COUNT(*) AS n FROM glasgow_answers WHERE set_id = ? AND q = ?').bind(set.id, id).first<{ n: number }>())?.n ?? 0;
	return json({ ok: true, created: !was, question: publicQuestion(checked.question), order: ord, answers });
}

/** DELETE /questions/<id> (presenter): the question and its answers. Not the one showing. */
export async function deleteQuestion(env: GlasgowEnv, request: Request, id: string) {
	const denied = presenter(env, request);
	if (denied) return denied;
	await ensureSchema(env.DB);
	const set = findSet(new URL(request.url).searchParams.get('set'));
	if (!set) return fail(404, 'No such question set.');
	if (!(await getQuestion(env, set, id))) return fail(404, 'No such question.');
	if ((await current(env, set)).current === id) return fail(409, 'That question is showing: switch to another (or to none) first.');
	if (await isFrozen(env, set.id, id)) return frozenFail();
	const res = await env.DB.batch([
		env.DB.prepare('DELETE FROM glasgow_qdefs WHERE set_id = ? AND id = ?').bind(set.id, id),
		env.DB.prepare('DELETE FROM glasgow_answer_teams WHERE answer_id IN (SELECT id FROM glasgow_answers WHERE set_id = ? AND q = ?)').bind(set.id, id),
		env.DB.prepare('DELETE FROM glasgow_answers WHERE set_id = ? AND q = ?').bind(set.id, id),
	]);
	return json({ ok: true, answers: res[2].meta.changes ?? 0 });
}

/**
 * POST /freeze {set, q} (presenter): freeze a poll. It stops taking answers (and is closed if it is showing), cannot be
 * made current, and every clear skips it, until POST /unfreeze. Freezing a frozen poll changes nothing.
 */
export async function postFreeze(env: GlasgowEnv, request: Request) {
	const denied = presenter(env, request);
	if (denied) return denied;
	await ensureSchema(env.DB);
	let body: any;
	try { body = await request.json(); } catch { return fail(400, 'Expected JSON.'); }
	const set = findSet(typeof body?.set === 'string' ? body.set : null);
	if (!set) return fail(404, 'No such question set.');
	const q = await getQuestion(env, set, body?.q);
	if (!q) return fail(404, 'No such question.');
	const t = now();
	const [ins] = await env.DB.batch([
		env.DB.prepare('INSERT INTO glasgow_frozen (set_id, q, at, counts) VALUES (?, ?, ?, NULL) ON CONFLICT (set_id, q) DO NOTHING').bind(set.id, q.id, t),
		env.DB.prepare('UPDATE glasgow_state SET current = NULL, changed_at = ? WHERE set_id = ? AND current = ?').bind(t, set.id, q.id),
	]);
	return json({ ok: true, q: q.id, frozen: true, already: !(ins.meta.changes ?? 0) });
}

/**
 * POST /unfreeze {set, q} (presenter): the only way back. A poll with restored totals also needs
 * "discardRestored": true, since unfreezing it drops those totals for good (its answers were wiped before).
 */
export async function postUnfreeze(env: GlasgowEnv, request: Request) {
	const denied = presenter(env, request);
	if (denied) return denied;
	await ensureSchema(env.DB);
	let body: any;
	try { body = await request.json(); } catch { return fail(400, 'Expected JSON.'); }
	const set = findSet(typeof body?.set === 'string' ? body.set : null);
	if (!set) return fail(404, 'No such question set.');
	const q = typeof body?.q === 'string' ? body.q : '';
	const row = q ? await env.DB.prepare('SELECT counts FROM glasgow_frozen WHERE set_id = ? AND q = ?').bind(set.id, q).first<{ counts: string | null }>() : null;
	if (!row) return fail(404, 'No such frozen poll.');
	if (row.counts !== null && body?.discardRestored !== true) return fail(409, 'This poll shows restored totals, which unfreezing deletes for good: send "discardRestored": true to do it anyway.');
	await env.DB.prepare('DELETE FROM glasgow_frozen WHERE set_id = ? AND q = ?').bind(set.id, q).run();
	return json({ ok: true, q, frozen: false });
}
