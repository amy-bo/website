import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getLatestThreads, parseLatest, describe } from '../src/lib/forum.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/latest.json', import.meta.url), 'utf8'));
const okFetch = async () => ({ ok: true, json: async () => fixture });

test('live path: parses Discourse latest.json, newest first, pinned dropped, limit honoured', async () => {
	const threads = await getLatestThreads({ fetchImpl: okFetch, limit: 3 });
	assert.equal(threads.length, 3);
	assert.deepEqual(threads.map((t) => t.id), [166, 163, 140]);
	assert.equal(threads[0].url, 'https://forum.amybo.org/t/current-measurement-experiment/166');
	assert.equal(threads[0].posts, 4);
	assert.equal(describe(threads[0]), '3 replies, 12 Aug 2026');
	assert.equal(describe({ posts: 1, lastPosted: '' }), 'no replies yet');
});

test('fallback path: unreachable forum gives an empty list, quickly', async () => {
	const start = Date.now();
	const threads = await getLatestThreads({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
	assert.deepEqual(threads, []);
	assert.ok(Date.now() - start < 1000);
});

test('fallback path: timeout aborts and gives an empty list', async () => {
	const hanging = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
	const threads = await getLatestThreads({ fetchImpl: hanging, timeoutMs: 50 });
	assert.deepEqual(threads, []);
});

test('fallback path: bad status or bad shape gives an empty list', async () => {
	assert.deepEqual(await getLatestThreads({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) }), []);
	assert.deepEqual(await getLatestThreads({ fetchImpl: async () => ({ ok: true, json: async () => ({ hello: 'world' }) }) }), []);
	assert.deepEqual(parseLatest({ topic_list: { topics: [{ id: 'x', title: 'no', slug: 'bad slug!' }] } }), []);
	assert.deepEqual(parseLatest(null), []);
});

test('FORUM_FEED=off skips the fetch entirely', async () => {
	process.env.FORUM_FEED = 'off';
	let called = false;
	const threads = await getLatestThreads({ fetchImpl: async () => { called = true; return { ok: true, json: async () => fixture }; } });
	delete process.env.FORUM_FEED;
	assert.deepEqual(threads, []);
	assert.equal(called, false);
});
