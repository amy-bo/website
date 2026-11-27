// Live lecture polling: frozen polls, against the real src/glasgow/ code on an in-memory SQLite stand-in for D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1.mjs';

register('./helpers/ts-resolve.mjs', import.meta.url);
const db = await import('../src/glasgow/db.ts');
const aud = await import('../src/glasgow/audience.ts');
const { snapshotCounts } = await import('../src/glasgow/core.ts');

const TOKEN = 'unit-presenter';
const MIGRATION = new URL('../eventsandeye/migrations/0013_glasgow_frozen_polls.sql', import.meta.url);
const P101 = { type: 'choice', prompt: 'Which altProtein would you most want to work on', options: ['Cultivated Meat', 'Plant Based', 'Biomass Ferm.', 'Precision Ferm.', 'Insects', 'Other'] };
const P93B = { type: 'choice', prompt: 'Which remote experiment do you want to run?', options: ['Spirulina', 'Glasgow altProtein', 'May fridge sample', 'Other (discuss)'] };
const dev = (n) => `device-${String(n).padStart(12, '0')}`;

/** A fresh database with the Why set's tables, the two Wednesday polls and one ordinary poll, as on the live server. */
async function setup({ migrate = true } = {}) {
	const DB = d1();
	const env = { DB, GLASGOW_PRESENTER_TOKEN: TOKEN, TOKEN_SECRET: 'unit' };
	await db.ensureSchema(DB);
	for (const [id, def] of [['p101-2', P101], ['pnew-93b-3', P93B], ['live', { type: 'choice', prompt: 'Today?', options: ['A', 'B'] }]])
		assert.equal((await call(env, db.putQuestion, 'PUT', `/questions/${id}`, { set: 'why-2026', ...def }, id)).status, 200, id);
	if (migrate) DB.raw.exec(readFileSync(MIGRATION, 'utf8'));
	return env;
}
async function call(env, fn, method, path, body, ...extra) {
	const req = new Request('https://amybo.org/api/glasgow' + path, { method, headers: { 'content-type': 'application/json', 'x-presenter-token': TOKEN, 'cf-connecting-ip': '192.0.2.9' }, body: body === undefined ? undefined : JSON.stringify(body) });
	const res = await fn(env, req, ...extra);
	return { status: res.status, data: await res.json() };
}
const results = (env, q) => call(env, (e, r) => db.getResults(e, 'why-2026', q), 'GET', '/results?q=' + q);
const state = (env) => call(env, (e) => db.getState(e, 'why-2026'), 'GET', '/state');
const answer = (env, q, value, n) => call(env, db.postAnswer, 'POST', '/answer', { set: 'why-2026', q, value, device: dev(n) });
const open = (env, q) => call(env, db.postCurrent, 'POST', '/current', { set: 'why-2026', q });

test('the restored polls: the recorded totals, frozen, in /results and /state', async () => {
	const env = await setup();
	const a = await results(env, 'p101-2');
	assert.equal(a.status, 200);
	assert.deepEqual([a.data.counts, a.data.count, a.data.frozen, a.data.restored, a.data.picks], [[3, 3, 4, 1, 1, 0], 12, true, true, []]);
	assert.deepEqual(a.data.options, P101.options);
	const b = await results(env, 'pnew-93b-3');
	assert.deepEqual([b.data.counts, b.data.count, b.data.frozen], [[1, 7, 4, 0], 12, true]);
	const s = await state(env);
	const byId = Object.fromEntries(s.data.questions.map((q) => [q.id, q]));
	assert.equal(byId['p101-2'].frozen, true);
	assert.equal(byId['pnew-93b-3'].frozen, true);
	assert.ok(!('frozen' in byId.live), 'an ordinary poll has no frozen key');
	const live = await results(env, 'live');
	assert.ok(!('frozen' in live.data) && !('restored' in live.data));
});

test('the migration is idempotent and creates the same table the code does', async () => {
	const env = await setup();
	env.DB.raw.exec(readFileSync(MIGRATION, 'utf8'));
	assert.deepEqual((await results(env, 'p101-2')).data.counts, [3, 3, 4, 1, 1, 0]);
	const fresh = d1();
	fresh.raw.exec(readFileSync(MIGRATION, 'utf8'));                 // before the code ever ran: the table is made here
	await db.ensureSchema(fresh);                                    // and the code's own CREATE leaves it alone
	assert.equal(fresh.raw.prepare('SELECT COUNT(*) AS n FROM glasgow_frozen').get().n, 2);
});

test('a frozen poll refuses answers and cannot be made current', async () => {
	const env = await setup();
	assert.equal((await open(env, 'p101-2')).status, 409);
	assert.equal((await open(env, 'live')).status, 200);
	assert.equal((await answer(env, 'live', 1, 1)).status, 200);
	assert.equal((await call(env, db.postFreeze, 'POST', '/freeze', { set: 'why-2026', q: 'live' })).data.frozen, true);
	const s = await state(env);
	assert.equal(s.data.current, null, 'freezing the poll showing closes it');
	assert.equal((await answer(env, 'live', 0, 2)).status, 409, 'no new answers');
	// Even if it were somehow still current (a stale state row), the answer is refused.
	env.DB.raw.exec("UPDATE glasgow_state SET current = 'live' WHERE set_id = 'why-2026'");
	assert.equal((await answer(env, 'live', 0, 3)).status, 409);
	assert.deepEqual((await results(env, 'live')).data.counts, [0, 1], 'the answer from before the freeze stays');
});

test('clear all skips frozen polls; one-poll clear and delete refuse them', async () => {
	const env = await setup();
	await open(env, 'live');
	for (const n of [1, 2, 3]) await answer(env, 'live', n % 2, n);
	const c = await call(env, aud.postClear, 'POST', '/clear', { set: 'why-2026', all: true });
	assert.equal(c.status, 200);
	assert.equal(c.data.answers, 3);
	assert.deepEqual(c.data.frozenKept, ['p101-2', 'pnew-93b-3']);
	assert.deepEqual((await results(env, 'live')).data.counts, [0, 0], 'the unfrozen poll is cleared');
	assert.deepEqual((await results(env, 'p101-2')).data.counts, [3, 3, 4, 1, 1, 0], 'the frozen ones are not');
	assert.deepEqual((await results(env, 'pnew-93b-3')).data.counts, [1, 7, 4, 0]);
	// A poll frozen with real answers keeps those answers through clear all.
	for (const n of [4, 5]) await answer(env, 'live', 1, n);
	await call(env, db.postFreeze, 'POST', '/freeze', { set: 'why-2026', q: 'live' });
	assert.equal((await call(env, aud.postClear, 'POST', '/clear', { set: 'why-2026', all: true })).data.answers, 0);
	assert.deepEqual((await results(env, 'live')).data.counts, [0, 2]);
	assert.equal((await call(env, aud.postClear, 'POST', '/clear', { set: 'why-2026', q: 'live' })).status, 409);
	assert.equal((await call(env, db.deleteQuestion, 'DELETE', '/questions/live?set=why-2026', undefined, 'live')).status, 409);
	assert.deepEqual((await results(env, 'live')).data.counts, [0, 2]);
});

test('a frozen poll keeps its definition: the same one again is fine, a different one is refused', async () => {
	const env = await setup();
	assert.equal((await call(env, db.putQuestion, 'PUT', '/questions/p101-2', { set: 'why-2026', ...P101 }, 'p101-2')).status, 200);
	assert.equal((await call(env, db.putQuestion, 'PUT', '/questions/p101-2', { set: 'why-2026', ...P101, options: ['A', 'B'] }, 'p101-2')).status, 409);
	assert.deepEqual((await results(env, 'p101-2')).data.counts, [3, 3, 4, 1, 1, 0]);
});

test('freeze and unfreeze: presenter only; unfreezing is explicit, and restored totals need discardRestored', async () => {
	const env = await setup();
	const noTok = new Request('https://amybo.org/api/glasgow/freeze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ set: 'why-2026', q: 'live' }) });
	assert.equal((await db.postFreeze(env, noTok)).status, 401);
	assert.equal((await call(env, db.postFreeze, 'POST', '/freeze', { set: 'why-2026', q: 'nope' })).status, 404);
	assert.equal((await call(env, db.postFreeze, 'POST', '/freeze', { set: 'why-2026', q: 'live' })).data.already, false);
	assert.equal((await call(env, db.postFreeze, 'POST', '/freeze', { set: 'why-2026', q: 'live' })).data.already, true);
	assert.equal((await call(env, db.postUnfreeze, 'POST', '/unfreeze', { set: 'why-2026', q: 'live' })).status, 200);
	assert.equal((await open(env, 'live')).status, 200, 'open again after unfreezing');
	assert.equal((await call(env, db.postUnfreeze, 'POST', '/unfreeze', { set: 'why-2026', q: 'live' })).status, 404, 'not frozen');
	assert.equal((await call(env, db.postUnfreeze, 'POST', '/unfreeze', { set: 'why-2026', q: 'p101-2' })).status, 409);
	assert.equal((await results(env, 'p101-2')).data.count, 12, 'still restored');
	assert.equal((await call(env, db.postUnfreeze, 'POST', '/unfreeze', { set: 'why-2026', q: 'p101-2', discardRestored: true })).status, 200);
	const r = await results(env, 'p101-2');
	assert.deepEqual([r.data.count, 'frozen' in r.data], [0, false]);
});

test('restored totals are used only when they fit the question', () => {
	const q = { id: 'x', type: 'choice', prompt: 'x', options: ['A', 'B'] };
	assert.deepEqual(snapshotCounts(q, '[2,5]'), [2, 5]);
	for (const bad of [null, undefined, '', 'nope', '[1]', '[1,2,3]', '[1,-1]', '[1,1.5]', '{"a":1}', '["1",2]']) assert.equal(snapshotCounts(q, bad), null, String(bad));
	assert.equal(snapshotCounts({ id: 'n', type: 'number', prompt: 'x', min: 0, max: 1, step: 1, scale: 'linear', unit: '', bins: [0, 1] }, '[1,1]'), null, 'choice only');
});
