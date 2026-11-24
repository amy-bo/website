// Live lecture polling: hands up and audience questions or comments. Presenter-only to read; never shown publicly.
// Every question and every hand going up or down is kept with its (anonymous, random) device id and time until the
// set's deleteAfter, as a record the presenter can go back to.
import { DEVICE_RE, fail, json, rateKey } from './core';
import { ensureSchema, getQuestion, now, presenter, underLimit, type GlasgowEnv } from './db';
import { findSet, type QuestionSet } from './sets';

/** A raised hand counts while its phone re-sends it at least this often (the page re-sends every 60 s). */
export const HAND_STALE_MS = 3 * 60_000;
/** One question per device per second: a guard against a stuck button, not a limit on how much anyone asks. */
const QUESTION_GAP_MS = 1000;
/** Hands and questions from one address per minute: generous, against scripts. */
const PER_ADDRESS_PER_MINUTE = 600;
export const MAX_QUESTION = 500;
const short = (device: string) => device.slice(0, 8);

async function readBody(request: Request) {
	try { return { ok: true as const, body: await request.json() as any }; } catch { return { ok: false as const }; }
}
function setOf(body: any) {
	return findSet(typeof body?.set === 'string' ? body.set : null);
}
async function addressOk(env: GlasgowEnv, request: Request) {
	const addr = await rateKey(request.headers.get('cf-connecting-ip') || 'unknown', env.TOKEN_SECRET || '');
	return underLimit(env, 'aud:' + addr, PER_ADDRESS_PER_MINUTE);
}
const open = (set: QuestionSet) => new Date(set.deleteAfter).getTime() > Date.now();

export async function postHand(env: GlasgowEnv, request: Request) {
	await ensureSchema(env.DB);
	const r = await readBody(request);
	if (!r.ok) return fail(400, 'Expected JSON.');
	const set = setOf(r.body);
	if (!set) return fail(404, 'No such question set.');
	const device = typeof r.body?.device === 'string' ? r.body.device : '';
	if (!DEVICE_RE.test(device)) return fail(400, 'Missing or malformed device id.');
	if (typeof r.body?.up !== 'boolean') return fail(400, 'Say whether the hand is up: "up": true or false.');
	if (!open(set)) return fail(410, 'This lecture has finished.');
	if (!(await addressOk(env, request))) return fail(429, 'Too many just now: please wait a minute.');
	const t = now(), up = r.body.up as boolean;
	const was = await env.DB.prepare('SELECT up, since, seen_at FROM glasgow_hands WHERE set_id = ? AND device = ?').bind(set.id, device).first<{ up: number; since: string; seen_at: string }>();
	const wasUp = !!was?.up && Date.now() - Date.parse(was.seen_at) < HAND_STALE_MS;
	const changed = up !== wasUp;
	const stmts = [env.DB.prepare(`INSERT INTO glasgow_hands (set_id, device, up, since, seen_at, delete_after) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (set_id, device) DO UPDATE SET up = excluded.up, since = CASE WHEN ? THEN excluded.since ELSE glasgow_hands.since END, seen_at = excluded.seen_at`)
		.bind(set.id, device, up ? 1 : 0, t, t, set.deleteAfter, changed ? 1 : 0)];
	if (changed) stmts.push(env.DB.prepare('INSERT INTO glasgow_hand_events (set_id, device, up, at, delete_after) VALUES (?, ?, ?, ?, ?)').bind(set.id, device, up ? 1 : 0, t, set.deleteAfter));
	await env.DB.batch(stmts);
	return json({ ok: true, up });
}

export async function postQuestion(env: GlasgowEnv, request: Request) {
	await ensureSchema(env.DB);
	const r = await readBody(request);
	if (!r.ok) return fail(400, 'Expected JSON.');
	const set = setOf(r.body);
	if (!set) return fail(404, 'No such question set.');
	const device = typeof r.body?.device === 'string' ? r.body.device : '';
	if (!DEVICE_RE.test(device)) return fail(400, 'Missing or malformed device id.');
	if (typeof r.body?.text !== 'string') return fail(400, 'Please type a question or comment.');
	const text = r.body.text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
	if (!text) return fail(400, 'Please type a question or comment.');
	if ([...text].length > MAX_QUESTION) return fail(400, `Please keep it to ${MAX_QUESTION} characters.`);
	if (!open(set)) return fail(410, 'This lecture has finished.');
	const last = await env.DB.prepare('SELECT MAX(at) AS at FROM glasgow_questions WHERE device = ? AND set_id = ?').bind(device, set.id).first<{ at: string | null }>();
	if (last?.at && Date.now() - Date.parse(last.at) < QUESTION_GAP_MS) return fail(429, 'One moment, then send again.');
	if (!(await addressOk(env, request))) return fail(429, 'Too many just now: please wait a minute.');
	const slide = await env.DB.prepare('SELECT n, key FROM glasgow_slide WHERE set_id = ?').bind(set.id).first<{ n: number | null; key: string | null }>();
	const row = await env.DB.prepare('INSERT INTO glasgow_questions (set_id, device, text, at, slide_n, slide_key, delete_after) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
		.bind(set.id, device, text, now(), slide?.n ?? null, slide?.key ?? null, set.deleteAfter).first<{ id: number }>();
	return json({ ok: true, id: row?.id ?? null });
}

export async function postSlide(env: GlasgowEnv, request: Request) {
	const denied = presenter(env, request);
	if (denied) return denied;
	await ensureSchema(env.DB);
	const r = await readBody(request);
	if (!r.ok) return fail(400, 'Expected JSON.');
	const set = setOf(r.body);
	if (!set) return fail(404, 'No such question set.');
	const n = r.body?.n === null || r.body?.n === undefined ? null : Number(r.body.n);
	if (n !== null && !Number.isInteger(n)) return fail(400, '"n" should be a whole slide number.');
	const key = typeof r.body?.key === 'string' ? r.body.key.slice(0, 100) : null;
	await env.DB.prepare('INSERT INTO glasgow_slide (set_id, n, key, at) VALUES (?, ?, ?, ?) ON CONFLICT (set_id) DO UPDATE SET n = excluded.n, key = excluded.key, at = excluded.at')
		.bind(set.id, n, key, now()).run();
	return json({ ok: true });
}

export async function getAudience(env: GlasgowEnv, request: Request) {
	const denied = presenter(env, request);
	if (denied) return denied;
	await ensureSchema(env.DB);
	const set = findSet(new URL(request.url).searchParams.get('set'));
	if (!set) return fail(404, 'No such question set.');
	const fresh = new Date(Date.now() - HAND_STALE_MS).toISOString();
	const [hands, questions] = await env.DB.batch([
		env.DB.prepare('SELECT device, since FROM glasgow_hands WHERE set_id = ? AND up = 1 AND seen_at > ? ORDER BY since, device').bind(set.id, fresh),
		env.DB.prepare(`SELECT id, text, at, slide_n, slide_key, device, answered_at FROM glasgow_questions
			WHERE set_id = ? AND id > COALESCE((SELECT questions_after FROM glasgow_clears WHERE set_id = ?), 0) ORDER BY id`).bind(set.id, set.id),
	]);
	const h = (hands.results as { device: string; since: string }[]).map((x) => ({ device: short(x.device), since: x.since }));
	const q = (questions.results as { id: number; text: string; at: string; slide_n: number | null; slide_key: string | null; device: string; answered_at: string | null }[])
		.map((x) => ({ id: x.id, text: x.text, at: x.at, slide: x.slide_n === null && x.slide_key === null ? null : { n: x.slide_n, key: x.slide_key }, device: short(x.device), answered: !!x.answered_at, answeredAt: x.answered_at }));
	return json({ hands: { count: h.length, devices: h }, questions: q, updatedAt: now() });
}

export async function postAnswered(env: GlasgowEnv, request: Request) {
	const denied = presenter(env, request);
	if (denied) return denied;
	await ensureSchema(env.DB);
	const r = await readBody(request);
	if (!r.ok) return fail(400, 'Expected JSON.');
	const set = setOf(r.body);
	if (!set) return fail(404, 'No such question set.');
	const id = Number(r.body?.id);
	if (!Number.isInteger(id) || id <= 0) return fail(400, 'Missing question id.');
	const answered = r.body?.answered !== false;
	const res = await env.DB.prepare('UPDATE glasgow_questions SET answered_at = ? WHERE id = ? AND set_id = ?').bind(answered ? now() : null, id, set.id).run();
	if (!res.meta.changes) return fail(404, 'No such question.');
	return json({ ok: true });
}

export async function postClearHands(env: GlasgowEnv, request: Request) {
	const denied = presenter(env, request);
	if (denied) return denied;
	await ensureSchema(env.DB);
	const r = await readBody(request).catch(() => ({ ok: false as const }));
	const set = findSet(r.ok && typeof r.body?.set === 'string' ? r.body.set : null);
	if (!set) return fail(404, 'No such question set.');
	const t = now(), fresh = new Date(Date.now() - HAND_STALE_MS).toISOString();
	const up = (await env.DB.prepare('SELECT device FROM glasgow_hands WHERE set_id = ? AND up = 1 AND seen_at > ?').bind(set.id, fresh).all<{ device: string }>()).results;
	await env.DB.batch([
		env.DB.prepare('UPDATE glasgow_hands SET up = 0, seen_at = ? WHERE set_id = ? AND up = 1').bind(t, set.id),
		...up.map((x) => env.DB.prepare('INSERT INTO glasgow_hand_events (set_id, device, up, at, delete_after) VALUES (?, ?, 0, ?, ?)').bind(set.id, x.device, t, set.deleteAfter)),
	]);
	return json({ ok: true, lowered: up.length });
}

/**
 * Clear, for wiping a rehearsal. {q}: delete that question's answers. {all: true}: delete every answer in the set,
 * lower every hand, and take every question off the presenter's list. Questions and hand events stay in the record
 * (until deleteAfter), as Martin asked; only answers to the polls are deleted.
 */
export async function postClear(env: GlasgowEnv, request: Request) {
	const denied = presenter(env, request);
	if (denied) return denied;
	await ensureSchema(env.DB);
	const r = await readBody(request);
	if (!r.ok) return fail(400, 'Expected JSON.');
	const set = setOf(r.body);
	if (!set) return fail(404, 'No such question set.');
	if (r.body?.all === true) {
		const t = now(), fresh = new Date(Date.now() - HAND_STALE_MS).toISOString();
		const up = (await env.DB.prepare('SELECT device FROM glasgow_hands WHERE set_id = ? AND up = 1 AND seen_at > ?').bind(set.id, fresh).all<{ device: string }>()).results;
		const res = await env.DB.batch([
			env.DB.prepare('DELETE FROM glasgow_answers WHERE set_id = ?').bind(set.id),
			env.DB.prepare(`INSERT INTO glasgow_clears (set_id, questions_after, at) VALUES (?, COALESCE((SELECT MAX(id) FROM glasgow_questions WHERE set_id = ?), 0), ?)
				ON CONFLICT (set_id) DO UPDATE SET questions_after = excluded.questions_after, at = excluded.at`).bind(set.id, set.id, t),
			env.DB.prepare('UPDATE glasgow_hands SET up = 0, seen_at = ? WHERE set_id = ? AND up = 1').bind(t, set.id),
			...up.map((x) => env.DB.prepare('INSERT INTO glasgow_hand_events (set_id, device, up, at, delete_after) VALUES (?, ?, 0, ?, ?)').bind(set.id, x.device, t, set.deleteAfter)),
		]);
		const answers = res[0].meta.changes ?? 0;
		const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM glasgow_questions WHERE set_id = ?').bind(set.id).first<{ n: number }>();
		return json({ ok: true, cleared: answers + up.length, answers, hands: up.length, questionsHidden: before?.n ?? 0 });
	}
	const q = await getQuestion(env, set, r.body?.q);
	if (!q) return fail(404, 'No such question: send {"q": "<id>"} or {"all": true}.');
	const res = await env.DB.prepare('DELETE FROM glasgow_answers WHERE set_id = ? AND q = ?').bind(set.id, q.id).run();
	return json({ ok: true, cleared: res.meta.changes ?? 0 });
}
