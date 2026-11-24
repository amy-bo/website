#!/usr/bin/env node
/**
 * End-to-end test of live lecture polling (amybo.org/glasgow) against a local D1 database with `wrangler pages dev`.
 *   npm run build:test && node tests/glasgow.e2e.mjs
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORT = 8793, BASE = `http://127.0.0.1:${PORT}`, PERSIST = '.wrangler/glasgow-e2e', TOKEN = ['e2e', 'presenter'].join('-');
let failed = 0, passed = 0, server, log = '';
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); } };
async function call(method, path, body, headers = {}) {
	const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
	const text = await res.text();
	let data = null; try { data = JSON.parse(text); } catch {}
	return { status: res.status, data, headers: res.headers };
}
const presenter = { 'x-presenter-token': TOKEN };
const dev = (n) => `device-${String(n).padStart(12, '0')}`;

try {
	rmSync(PERSIST, { recursive: true, force: true });
	// No schema step: the API creates its tables on first use, as it does in production.
	server = spawn('npx', ['wrangler', 'pages', 'dev', './dist', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST, '--binding', `GLASGOW_PRESENTER_TOKEN=${TOKEN}`, '--binding', 'TOKEN_SECRET=e2e'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' }, detached: true });
	server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
	for (let i = 0; ; i++) {
		try { if ((await fetch(`${BASE}/api/glasgow/state`)).status < 500) break; } catch {}
		if (i > 120) throw new Error(`wrangler pages dev did not start:\n${log.slice(-2000)}`);
		await new Promise((r) => setTimeout(r, 500));
	}

	console.log('The page');
	const page = await fetch(`${BASE}/glasgow/`);
	const html = await page.text();
	check('amybo.org/glasgow is served', page.status === 200 && /Live questions/.test(html), String(page.status));
	check('…with the anonymity notice', html.includes('Anonymous answers, shown live in the lecture.'));

	console.log('State and CORS');
	let s = await call('GET', '/api/glasgow/state');
	check('state: no question showing yet, the three questions listed', s.status === 200 && s.data.current === null && s.data.questions.map((q) => q.id).join() === 'q00,q42,q61,q93,q105,q106' && s.data.set === 'why-2026' && s.data.pollSeconds === 2, JSON.stringify(s.data));
	check('state: open to any origin, never cached', s.headers.get('access-control-allow-origin') === '*' && s.headers.get('cache-control') === 'no-store');
	check('state: no internal bins in the public question list', !('bins' in s.data.questions[0]));
	const pre = await fetch(`${BASE}/api/glasgow/current`, { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-presenter-token' } });
	check('preflight from a file:// slide allows the presenter header', pre.status === 204 && /x-presenter-token/.test(pre.headers.get('access-control-allow-headers') || '') && pre.headers.get('access-control-allow-origin') === '*');

	console.log('Answers only for the question showing');
	let r = await call('POST', '/api/glasgow/answer', { q: 'q42', value: 3, device: dev(1) });
	check('an answer before the question opens → 409', r.status === 409, JSON.stringify(r));

	console.log('Presenter');
	check('switching without the token → 401', (await call('POST', '/api/glasgow/current', { q: 'q42' })).status === 401);
	check('…or with a wrong one → 401', (await call('POST', '/api/glasgow/current', { q: 'q42' }, { 'x-presenter-token': 'nope' })).status === 401);
	check('an unknown question → 404', (await call('POST', '/api/glasgow/current', { q: 'q99' }, presenter)).status === 404);
	r = await call('POST', '/api/glasgow/current', { q: 'q42' }, presenter);
	check('the presenter opens q42', r.status === 200 && r.data.current === 'q42', JSON.stringify(r));
	s = await call('GET', '/api/glasgow/state');
	check('state shows q42, with when it changed', s.data.current === 'q42' && !!s.data.changedAt);

	console.log('q42: numbers');
	for (const [n, v] of [[1, 3], [2, 2.5], [3, '4.04'], [4, 1]]) await call('POST', '/api/glasgow/answer', { q: 'q42', value: v, device: dev(n) });
	r = await call('POST', '/api/glasgow/answer', { q: 'q42', value: 2, device: dev(1) });
	check('a device can change its answer', r.status === 200 && r.data.value === 2, JSON.stringify(r));
	check('out of range → 400', (await call('POST', '/api/glasgow/answer', { q: 'q42', value: 6, device: dev(5) })).status === 400);
	check('not a number → 400', (await call('POST', '/api/glasgow/answer', { q: 'q42', value: 'hot', device: dev(5) })).status === 400);
	check('a malformed device id → 400', (await call('POST', '/api/glasgow/answer', { q: 'q42', value: 3, device: 'x' })).status === 400);
	check('not JSON → 400', (await fetch(`${BASE}/api/glasgow/answer`, { method: 'POST', body: 'nope' })).status === 400);
	r = await call('GET', '/api/glasgow/results?q=q42');
	check('results: one answer per device, changed answers replaced', r.data.count === 4 && JSON.stringify(r.data.values) === '[1,2,2.5,4]', JSON.stringify(r.data));
	check('results: mean, median and bins', r.data.mean === 2.375 && r.data.median === 2.25 && r.data.bins.length === 8 && r.data.bins.reduce((a, b) => a + b.n, 0) === 4, JSON.stringify(r.data));
	check('results: open to any origin, never cached', r.headers.get('access-control-allow-origin') === '*' && r.headers.get('cache-control') === 'no-store');
	check('results: nothing about devices', !JSON.stringify(r.data).includes('device-'));
	check('results for an unknown question → 404', (await call('GET', '/api/glasgow/results?q=q99')).status === 404);

	console.log('q61: log scale');
	await call('POST', '/api/glasgow/current', { q: 'q61' }, presenter);
	check('the closed question no longer takes answers', (await call('POST', '/api/glasgow/answer', { q: 'q42', value: 3, device: dev(9) })).status === 409);
	for (const [n, v] of [[1, 0.1], [2, 0.0001], [3, 75]]) await call('POST', '/api/glasgow/answer', { q: 'q61', value: v, device: dev(n) });
	r = await call('GET', '/api/glasgow/results?q=q61');
	check('q61 totals: 0.0001 % to 100 %, one bin per decade', r.data.count === 3 && r.data.median === 0.1 && r.data.bins.length === 6 && r.data.bins[0].n === 1 && r.data.bins.at(-1).n === 1, JSON.stringify(r.data));
	check('q61 refuses 0 (below 0.0001 %)', (await call('POST', '/api/glasgow/answer', { q: 'q61', value: 0, device: dev(4) })).status === 400);
	check('q42 results are kept after it closes', (await call('GET', '/api/glasgow/results?q=q42')).data.count === 4);

	console.log('q93: text, filtered and moderated');
	await call('POST', '/api/glasgow/current', { q: 'q93' }, presenter);
	await call('POST', '/api/glasgow/answer', { q: 'q93', value: 'Grass to cow', device: dev(1) });
	await call('POST', '/api/glasgow/answer', { q: 'q93', value: 'cow to   steak', device: dev(2) });
	r = await call('POST', '/api/glasgow/answer', { q: 'q93', value: 'sh1t question', device: dev(3) });
	check('a filtered text is accepted, quietly', r.status === 200);
	check('81 characters → 400', (await call('POST', '/api/glasgow/answer', { q: 'q93', value: 'x'.repeat(81), device: dev(4) })).status === 400);
	r = await call('GET', '/api/glasgow/results?q=q93');
	check('texts: newest first, tidied, the filtered one not shown', r.data.count === 2 && r.data.texts.map((t) => t.text).join('|') === 'cow to steak|Grass to cow', JSON.stringify(r.data));
	const cowId = r.data.texts[0].id;
	check('hiding needs the token', (await call('POST', '/api/glasgow/hide', { q: 'q93', id: cowId })).status === 401);
	check('the presenter hides a text', (await call('POST', '/api/glasgow/hide', { q: 'q93', id: cowId }, presenter)).status === 200);
	r = await call('GET', '/api/glasgow/results?q=q93');
	check('…and it is gone from the results', r.data.count === 1 && r.data.texts[0].text === 'Grass to cow', JSON.stringify(r.data));
	check('…and can be shown again', (await call('POST', '/api/glasgow/hide', { q: 'q93', id: cowId, hidden: false }, presenter)).status === 200 && (await call('GET', '/api/glasgow/results?q=q93')).data.count === 2);
	check('hiding an unknown answer → 404', (await call('POST', '/api/glasgow/hide', { q: 'q93', id: 999999 }, presenter)).status === 404);

	console.log('q00: a word cloud, many answers per phone');
	await call('POST', '/api/glasgow/current', { q: 'q00' }, presenter);
	r = await call('POST', '/api/glasgow/answer', { q: 'q00', value: 'Mushrooms', device: dev(1) });
	check('an answer is added, with its id', r.status === 200 && Number.isInteger(r.data.id), JSON.stringify(r));
	check('a second within 2 s → 429', (await call('POST', '/api/glasgow/answer', { q: 'q00', value: 'insects', device: dev(1) })).status === 429);
	await new Promise((res) => setTimeout(res, 2100));
	check('…and after 2 s it is added too', (await call('POST', '/api/glasgow/answer', { q: 'q00', value: 'insects', device: dev(1) })).status === 200);
	await call('POST', '/api/glasgow/answer', { q: 'q00', value: 'mushrooms ', device: dev(2) });
	await call('POST', '/api/glasgow/answer', { q: 'q00', value: 'MUSHROOMS', device: dev(3) });
	check('41 characters → 400', (await call('POST', '/api/glasgow/answer', { q: 'q00', value: 'x'.repeat(41), device: dev(4) })).status === 400);
	r = await call('GET', '/api/glasgow/results?q=q00');
	check('results: every answer, and the words counted case-insensitively', r.data.count === 4 && r.data.texts.length === 4 && JSON.stringify(r.data.words) === JSON.stringify([{ text: 'Mushrooms', n: 3 }, { text: 'insects', n: 1 }]), JSON.stringify(r.data));
	check('q00 answers do not touch the one-per-phone questions', (await call('GET', '/api/glasgow/results?q=q42')).data.count === 4);
	await call('POST', '/api/glasgow/current', { q: 'q93' }, presenter);

	console.log('Rate limits');
	let limited = 0;
	for (let i = 0; i < 32; i++) if ((await call('POST', '/api/glasgow/answer', { q: 'q93', value: `try ${i}`, device: dev(7) })).status === 429) limited++;
	check('one device sending more than 30 answers a minute is slowed down', limited === 2, String(limited));

	console.log('Hands up and questions');
	check('the audience list needs the token', (await call('GET', '/api/glasgow/audience')).status === 401);
	check('…and so does the slide', (await call('POST', '/api/glasgow/slide', { n: 1, key: 'a' })).status === 401);
	r = await call('POST', '/api/glasgow/question', { device: dev(1), text: 'Before any slide?' });
	check('a question before any slide', r.status === 200 && Number.isInteger(r.data.id), JSON.stringify(r));
	check('the presenter sets the slide', (await call('POST', '/api/glasgow/slide', { n: 42, key: 'warming' }, presenter)).status === 200);
	await new Promise((res) => setTimeout(res, 1100));
	r = await call('POST', '/api/glasgow/question', { device: dev(1), text: '  Why\r\n\r\n\r\n\r\nnot   insects?  ' });
	const qid = r.data?.id;
	check('a second question from the same phone, a second later', r.status === 200, JSON.stringify(r));
	check('…but not within the same second', (await call('POST', '/api/glasgow/question', { device: dev(1), text: 'again' })).status === 429);
	check('no word filter on questions: the record is kept as sent', (await call('POST', '/api/glasgow/question', { device: dev(2), text: 'this is shit' })).status === 200);
	check('501 characters → 400', (await call('POST', '/api/glasgow/question', { device: dev(3), text: 'x'.repeat(501) })).status === 400);
	check('an empty question → 400', (await call('POST', '/api/glasgow/question', { device: dev(3), text: '   ' })).status === 400);
	check('a hand up', (await call('POST', '/api/glasgow/hand', { device: dev(1), up: true })).data?.up === true);
	await call('POST', '/api/glasgow/hand', { device: dev(2), up: true });
	await call('POST', '/api/glasgow/hand', { device: dev(2), up: true });
	check('"up" must be true or false', (await call('POST', '/api/glasgow/hand', { device: dev(3), up: 'yes' })).status === 400);
	let a = await call('GET', '/api/glasgow/audience', undefined, presenter);
	check('audience: two hands up (sending it twice is still one hand)', a.status === 200 && a.data.hands.count === 2 && a.data.hands.devices[0].device === dev(1).slice(0, 8), JSON.stringify(a.data.hands));
	check('audience: every question, oldest first, with its slide and a short device id', a.data.questions.length === 3 && a.data.questions[0].slide === null
		&& a.data.questions[1].text === 'Why\n\nnot insects?' && a.data.questions[1].slide.n === 42 && a.data.questions[1].slide.key === 'warming' && a.data.questions[1].device === dev(1).slice(0, 8) && a.data.questions[2].text === 'this is shit', JSON.stringify(a.data.questions));
	check('audience: never cached, open to any origin', a.headers.get('cache-control') === 'no-store' && a.headers.get('access-control-allow-origin') === '*');
	check('ticking off a question needs the token', (await call('POST', '/api/glasgow/question/answered', { id: qid })).status === 401);
	check('the presenter ticks one off', (await call('POST', '/api/glasgow/question/answered', { id: qid, answered: true }, presenter)).status === 200);
	a = await call('GET', '/api/glasgow/audience', undefined, presenter);
	const ticked = a.data.questions.find((x) => x.id === qid);
	check('…and it shows as answered, with when', ticked.answered === true && !!ticked.answeredAt);
	await call('POST', '/api/glasgow/question/answered', { id: qid, answered: false }, presenter);
	check('…and can be unticked', (await call('GET', '/api/glasgow/audience', undefined, presenter)).data.questions.find((x) => x.id === qid).answered === false);
	check('an unknown question id → 404', (await call('POST', '/api/glasgow/question/answered', { id: 999999 }, presenter)).status === 404);
	await call('POST', '/api/glasgow/hand', { device: dev(1), up: false });
	check('a hand lowered', (await call('GET', '/api/glasgow/audience', undefined, presenter)).data.hands.count === 1);
	r = await call('POST', '/api/glasgow/hands/clear', undefined, presenter);
	check('the presenter lowers every hand', r.status === 200 && r.data.lowered === 1 && (await call('GET', '/api/glasgow/audience', undefined, presenter)).data.hands.count === 0, JSON.stringify(r));

	console.log('Clear');
	await call('POST', '/api/glasgow/hand', { device: dev(5), up: true });
	check('clearing needs the token', (await call('POST', '/api/glasgow/clear', { q: 'q42' })).status === 401);
	check('clearing an unknown question → 404', (await call('POST', '/api/glasgow/clear', { q: 'q99' }, presenter)).status === 404);
	r = await call('POST', '/api/glasgow/clear', { q: 'q42' }, presenter);
	check('clear one question: its answers go', r.status === 200 && r.data.cleared === 4 && (await call('GET', '/api/glasgow/results?q=q42')).data.count === 0, JSON.stringify(r));
	check('…and only its answers', (await call('GET', '/api/glasgow/results?q=q61')).data.count === 3);
	r = await call('POST', '/api/glasgow/clear', { all: true }, presenter);
	check('clear all: every answer, the hand, and the questions list', r.status === 200 && r.data.hands === 1 && r.data.answers > 0, JSON.stringify(r));
	const after = await Promise.all(['q00', 'q61', 'q93'].map((q) => call('GET', `/api/glasgow/results?q=${q}`)));
	check('…results all empty', after.every((x) => x.data.count === 0 && (x.data.texts?.length ?? 0) === 0 && (x.data.words?.length ?? 0) === 0), JSON.stringify(after.map((x) => x.data.count)));
	a = await call('GET', '/api/glasgow/audience', undefined, presenter);
	check('…audience empty', a.data.hands.count === 0 && a.data.questions.length === 0, JSON.stringify(a.data));
	await call('POST', '/api/glasgow/question', { device: dev(6), text: 'After the clear' });
	a = await call('GET', '/api/glasgow/audience', undefined, presenter);
	check('a new question after a clear is listed', a.data.questions.length === 1 && a.data.questions[0].text === 'After the clear', JSON.stringify(a.data.questions));

	console.log('Editing questions from the slides');
	check('adding a question needs the token', (await call('PUT', '/api/glasgow/questions/q120', { type: 'number', prompt: 'How many?', min: 0, max: 10, step: 1 })).status === 401);
	r = await call('PUT', '/api/glasgow/questions/q120', { type: 'number', prompt: 'How many cows?', min: 0, max: 10, step: 1, unit: 'cows', order: 15 }, presenter);
	check('the presenter adds a question', r.status === 200 && r.data.created === true && r.data.answers === 0 && r.data.order === 15, JSON.stringify(r));
	s = await call('GET', '/api/glasgow/state');
	check('…and the phones see it, in its place', s.data.questions.map((q) => q.id).join() === 'q00,q120,q42,q61,q93,q105,q106' && !('bins' in s.data.questions[1]), s.data.questions.map((q) => q.id).join());
	check('a bad question → 400 with a reason', (await call('PUT', '/api/glasgow/questions/q121', { type: 'number', prompt: 'x', min: 5, max: 1, step: 1 }, presenter)).data?.error === '"min" must be less than "max".');
	check('a bad id → 400', (await call('PUT', '/api/glasgow/questions/Q%20bad', { type: 'text', prompt: 'x' }, presenter)).status === 400);
	await call('POST', '/api/glasgow/current', { q: 'q120' }, presenter);
	await call('POST', '/api/glasgow/answer', { q: 'q120', value: 3, device: dev(1) });
	check('an answer to the new question', (await call('GET', '/api/glasgow/results?q=q120')).data.count === 1);
	r = await call('PUT', '/api/glasgow/questions/q120', { type: 'number', prompt: 'How many cows, really?', min: 0, max: 20, step: 1 }, presenter);
	check('editing it says how many answers it already has, and keeps its place', r.status === 200 && r.data.created === false && r.data.answers === 1 && r.data.order === 15, JSON.stringify(r));
	check('…and the phones see the edit', (await call('GET', '/api/glasgow/state')).data.questions[1].prompt === 'How many cows, really?');
	check('POST /questions with the id in the body works too', (await call('POST', '/api/glasgow/questions', { id: 'q122', type: 'text', prompt: 'One word?', maxLength: 20 }, presenter)).data?.created === true);
	check('deleting the question that is showing → 409', (await call('DELETE', '/api/glasgow/questions/q120', undefined, presenter)).status === 409);
	await call('POST', '/api/glasgow/current', { q: null }, presenter);
	check('deleting needs the token', (await call('DELETE', '/api/glasgow/questions/q120')).status === 401);
	r = await call('DELETE', '/api/glasgow/questions/q120', undefined, presenter);
	check('the presenter deletes it, with its answers', r.status === 200 && r.data.answers === 1 && (await call('GET', '/api/glasgow/results?q=q120')).status === 404, JSON.stringify(r));
	check('deleting an unknown question → 404', (await call('DELETE', '/api/glasgow/questions/q999', undefined, presenter)).status === 404);
	await call('DELETE', '/api/glasgow/questions/q122', undefined, presenter);
	check('the seeded questions are as they were', (await call('GET', '/api/glasgow/state')).data.questions.map((q) => q.id).join() === 'q00,q42,q61,q93,q105,q106');
	const pre2 = await fetch(`${BASE}/api/glasgow/questions/q1`, { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'PUT' } });
	check('preflight allows PUT and DELETE', /PUT/.test(pre2.headers.get('access-control-allow-methods') || '') && /DELETE/.test(pre2.headers.get('access-control-allow-methods') || ''));

	console.log('Closing');
	r = await call('POST', '/api/glasgow/current', { q: null }, presenter);
	check('the presenter can show nothing', r.status === 200 && r.data.current === null && (await call('GET', '/api/glasgow/state')).data.current === null);
} catch (e) {
	failed++;
	console.error(e);
} finally {
	if (server) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
	console.log(`\n${passed} passed, ${failed} failed`);
	process.exit(failed ? 1 : 0);
}
