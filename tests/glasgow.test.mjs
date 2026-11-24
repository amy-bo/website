// Live lecture polling (amybo.org/glasgow): the pure parts. The API itself is checked by tests/glasgow.e2e.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, choiceResults, isBlocked, numberResults, textResults, wordCounts, tokenMatches, rateKey, DEVICE_RE } from '../src/glasgow/core.ts';
import { SETS, ACTIVE_SET, findSet, findQuestion } from '../src/glasgow/sets.ts';

const set = findSet(ACTIVE_SET);
const q42 = findQuestion(set, 'q42'), q61 = findQuestion(set, 'q61'), q93 = findQuestion(set, 'q93');

test('the Why set has the three questions as briefed, deleted 30 days after the lecture', () => {
	assert.deepEqual(set.questions.map((q) => [q.id, q.type]), [['q00', 'text'], ['q42', 'number'], ['q61', 'number'], ['q93', 'text'], ['q105', 'number'], ['q106', 'number']]);
	assert.deepEqual([q42.min, q42.max, q42.step, q42.scale], [1, 5, 0.1, 'linear']);
	assert.deepEqual([q61.min, q61.max, q61.step, q61.scale, q61.unit], [0.0001, 100, 0.0001, 'log', '%']);
	const q00 = findQuestion(set, 'q00');
	assert.deepEqual([q00.type, q00.maxLength, q00.multiple, q00.maxPerDevice], ['text', 40, true, 30]);
	assert.equal(q93.maxLength, 80);
	assert.equal(set.deleteAfter, '2026-12-25T00:00:00Z');
	assert.equal(new Set(SETS.map((s) => s.id)).size, SETS.length, 'set ids are unique');
	for (const s of SETS) for (const q of s.questions) if (q.type === 'number') {
		assert.equal(q.bins[0], q.min, `${s.id}/${q.id}: bins start at min`);
		assert.equal(q.bins.at(-1), q.max, `${s.id}/${q.id}: bins end at max`);
	}
});

test('numbers: in range, rounded to the step; strings of numbers accepted; nonsense refused', () => {
	assert.deepEqual(checkAnswer(q42, 2.66), { ok: true, num: 2.7, text: null });
	assert.deepEqual(checkAnswer(q42, '3'), { ok: true, num: 3, text: null });
	assert.equal(checkAnswer(q42, 0.9).ok, false);
	assert.equal(checkAnswer(q42, 5.01).ok, false);
	for (const bad of [null, '', 'abc', NaN, Infinity, {}, []]) assert.equal(checkAnswer(q42, bad).ok, false, String(bad));
	assert.deepEqual(checkAnswer(q61, 0.0001), { ok: true, num: 0.0001, text: null });
	assert.deepEqual(checkAnswer(q61, 0.00037), { ok: true, num: 0.0004, text: null }, 'to the nearest 0.0001 %');
	assert.deepEqual(checkAnswer(q61, 100), { ok: true, num: 100, text: null });
	assert.equal(checkAnswer(q61, 0).ok, false, 'below 0.0001 %');
	assert.equal(checkAnswer(q61, 101).ok, false);
});

test('texts: tidied, up to 80 characters, non-strings refused', () => {
	assert.deepEqual(checkAnswer(q93, '  grass\n to   cow '), { ok: true, num: null, text: 'grass to cow' });
	assert.equal(checkAnswer(q93, 'x'.repeat(80)).ok, true);
	assert.equal(checkAnswer(q93, 'x'.repeat(81)).ok, false);
	assert.equal(checkAnswer(q93, '🐄'.repeat(80)).ok, true, 'counted in characters, not UTF-16 units');
	assert.equal(checkAnswer(q93, '   ').ok, false);
	assert.equal(checkAnswer(q93, 42).ok, false);
});

test('the word filter catches the obvious and its disguises, and leaves the food chain alone', () => {
	for (const t of ['shit', 'F.U.C.K this', 'sh1t', 'B!tch']) assert.equal(isBlocked(t), true, t);
	for (const t of ['grass to cow', 'Photosynthesis', 'the cow eating grass', 'Grass → cow → steak']) assert.equal(isBlocked(t), false, t);
});

test('number totals: sorted values, mean, median and bins, with the top edge in the last bin', () => {
	const r = numberResults(q42, [3, 1, 5, 2.5, 2.4]);
	assert.deepEqual(r.values, [1, 2.4, 2.5, 3, 5]);
	assert.equal(r.count, 5);
	assert.equal(r.mean, 2.78);
	assert.equal(r.median, 2.5);
	assert.deepEqual(r.bins.map((b) => b.n), [1, 0, 1, 1, 1, 0, 0, 1]);
	assert.equal(r.bins.reduce((a, b) => a + b.n, 0), 5, 'every value in a bin');
	assert.equal(numberResults(q42, [2, 4]).median, 3, 'even count: the middle two averaged');
	const empty = numberResults(q42, []);
	assert.deepEqual([empty.count, empty.mean, empty.median], [0, null, null]);
	assert.deepEqual(numberResults(q61, [0.0001, 0.0005, 0.02, 9.9, 10, 100]).bins.map((b) => b.n), [2, 0, 1, 0, 1, 2], 'one bin per decade');
});

test('choice questions: whole numbers only in range, one bin per choice', () => {
	const q105 = findQuestion(set, 'q105'), q106 = findQuestion(set, 'q106');
	assert.deepEqual(checkAnswer(q105, 2), { ok: true, num: 2, text: null });
	assert.deepEqual(checkAnswer(q106, 2.4), { ok: true, num: 2, text: null }, 'rounded to the step');
	assert.equal(checkAnswer(q106, 4).ok, false);
	assert.deepEqual(numberResults(q105, [1, 2, 2]).bins.map((b) => b.n), [1, 2]);
	assert.deepEqual(numberResults(q106, [1, 2, 3, 3]).bins.map((b) => b.n), [1, 1, 2]);
});

test('text totals: the latest 30, or every one for a word cloud, with word counts', () => {
	const rows = Array.from({ length: 40 }, (_, i) => ({ id: 40 - i, text: `t${i}`, at: `2026-11-25T12:00:${String(59 - i).padStart(2, '0')}Z` }));
	const r = textResults(q93, rows);
	assert.equal(r.texts.length, 30);
	assert.equal(r.count, 40);
	assert.equal(r.words.length, 40);
	assert.equal(textResults(findQuestion(set, 'q00'), rows).texts.length, 40);
	const w = wordCounts([{ text: 'Mushrooms', at: '2' }, { text: 'insects', at: '3' }, { text: 'mushrooms ', at: '1' }, { text: 'MUSHROOMS', at: '4' }, { text: 'cultured  meat', at: '5' }, { text: 'Insects', at: '6' }]);
	assert.deepEqual(w, [{ text: 'mushrooms', n: 3 }, { text: 'insects', n: 2 }, { text: 'cultured meat', n: 1 }], 'case-insensitive, spelt as first sent, most first');
});

test('presenter token and device ids', async () => {
	assert.equal(tokenMatches('abc', 'abc'), true);
	assert.equal(tokenMatches('abd', 'abc'), false);
	assert.equal(tokenMatches('ab', 'abc'), false);
	assert.equal(tokenMatches(null, 'abc'), false);
	assert.equal(tokenMatches('abc', undefined), false, 'no token configured: nobody is the presenter');
	assert.equal(tokenMatches('', ''), false);
	assert.equal(DEVICE_RE.test('aZ09_-aZ09_-aZ09'), true);
	assert.equal(DEVICE_RE.test('short'), false);
	assert.equal(DEVICE_RE.test('has space in it.......'), false);
	const k = await rateKey('192.0.2.1', 's');
	assert.match(k, /^[0-9a-f]{24}$/);
	assert.equal(k, await rateKey('192.0.2.1', 's'));
	assert.notEqual(k, await rateKey('192.0.2.1', 't'), 'keyed: not a plain hash of the address');
});

test('questions sent from the slides are checked strictly', async () => {
	const { checkQuestion, defaultBins } = await import('../src/glasgow/questions.ts');
	const ok = checkQuestion('q120', { type: 'number', prompt: ' How   many? ', min: 0, max: 100, step: 1 });
	assert.equal(ok.ok, true);
	assert.deepEqual([ok.question.prompt, ok.question.scale, ok.question.unit, ok.question.bins.length], ['How many?', 'linear', '', 11]);
	for (const [id, body, why] of [
		['Q1', { type: 'text', prompt: 'x' }, 'capital in id'],
		['a'.repeat(25), { type: 'text', prompt: 'x' }, 'id too long'],
		['q1', { type: 'text', prompt: '' }, 'no prompt'],
		['q1', { type: 'text', prompt: 'x'.repeat(201) }, 'prompt too long'],
		['q1', { type: 'poll', prompt: 'x' }, 'bad type'],
		['q1', { type: 'number', prompt: 'x', min: 5, max: 1, step: 1 }, 'min > max'],
		['q1', { type: 'number', prompt: 'x', min: 0, max: 1, step: 0 }, 'step 0'],
		['q1', { type: 'number', prompt: 'x', min: 0, max: 10, step: 0.1, scale: 'log' }, 'log from 0'],
		['q1', { type: 'number', prompt: 'x', min: '0', max: 10, step: 1 }, 'string min'],
		['q1', { type: 'text', prompt: 'x', maxLength: 501 }, 'maxLength too big'],
		['q1', { type: 'text', prompt: 'x', multiple: 'yes' }, 'multiple not boolean'],
		['q1', { id: 'q2', type: 'text', prompt: 'x' }, 'id mismatch'],
		['q1', { type: 'text', prompt: 'x', order: 1.5 }, 'fractional order'],
	]) assert.equal(checkQuestion(id, body).ok, false, why);
	const cloud = checkQuestion('cloud', { type: 'text', prompt: 'Words?', maxLength: 40, multiple: true });
	assert.deepEqual([cloud.question.multiple, cloud.question.maxPerDevice], [true, 30]);
	assert.deepEqual(defaultBins({ min: 0.0001, max: 100, step: 0.0001, scale: 'log' }), [0.0001, 0.001, 0.01, 0.1, 1, 10, 100], 'a bin per decade');
	assert.deepEqual(defaultBins({ min: 1, max: 3, step: 1, scale: 'linear' }), [1, 1.5, 2.5, 3], 'a bin per choice');
	assert.deepEqual(defaultBins({ min: 1, max: 2, step: 1, scale: 'linear' }), [1, 1.5, 2]);
	for (const id of ['q61', 'q105', 'q106']) { const q = findQuestion(set, id); assert.deepEqual(q.bins, defaultBins(q), `${id}: the seed's bins match what an edit would give`); }
});

test('choice questions: an option index in, counts per option out', async () => {
	const { checkQuestion } = await import('../src/glasgow/questions.ts');
	const c = checkQuestion('nuke', { type: 'choice', prompt: 'Nuclear war by 2100?', options: [' Yes ', 'No', "Don't know"] });
	assert.equal(c.ok, true);
	assert.deepEqual(c.question.options, ['Yes', 'No', "Don't know"]);
	for (const [options, why] of [[['Yes'], 'one option'], [Array.from({ length: 13 }, (_, i) => `o${i}`), 'thirteen'], [['Yes', ''], 'empty'], [['Yes', 'x'.repeat(41)], 'too long'], [['Yes', 'yes'], 'duplicate'], ['Yes,No', 'not a list']])
		assert.equal(checkQuestion('nuke', { type: 'choice', prompt: 'x', options }).ok, false, why);
	const q = c.question;
	assert.deepEqual(checkAnswer(q, 2), { ok: true, num: 2, text: null });
	assert.deepEqual(checkAnswer(q, '0'), { ok: true, num: 0, text: null });
	for (const bad of [3, -1, 1.5, 'Yes', null]) assert.equal(checkAnswer(q, bad).ok, false, String(bad));
	assert.deepEqual(choiceResults(q, [0, 2, 2, 1, 2]), { type: 'choice', options: ['Yes', 'No', "Don't know"], counts: [1, 1, 3], count: 5 });
});

test('choice colours: one per option, hex or null; a wrong count is dropped', async () => {
	const { checkQuestion } = await import('../src/glasgow/questions.ts');
	const base = { type: 'choice', prompt: 'Which?', options: ['A', 'B', 'C'] };
	assert.deepEqual(checkQuestion('c', { ...base, colors: ['#e8590c', null, '#6B7280'] }).question.colors, ['#E8590C', null, '#6B7280']);
	assert.equal(checkQuestion('c', { ...base, colors: ['#E8590C', null] }).question.colors, undefined, 'length mismatch: ignored');
	assert.equal(checkQuestion('c', { ...base, colors: [null, null, null] }).question.colors, undefined, 'all null: nothing to keep');
	assert.equal(checkQuestion('c', { ...base, colors: ['red', null, null] }).ok, false, 'not hex');
	assert.equal(checkQuestion('c', { ...base, colors: '#E8590C' }).ok, false, 'not a list');
	assert.equal(checkQuestion('c', { ...base, options: Array.from({ length: 12 }, (_, i) => `o${i}`) }).ok, true, 'twelve options');
	assert.equal(checkQuestion('c', { ...base, options: Array.from({ length: 13 }, (_, i) => `o${i}`) }).ok, false, 'thirteen');
	const q = checkQuestion('c', { ...base, colors: ['#E8590C', null, null] }).question;
	assert.deepEqual(choiceResults(q, [0]).colors, ['#E8590C', null, null], 'the results carry the colours for the chart');
});
