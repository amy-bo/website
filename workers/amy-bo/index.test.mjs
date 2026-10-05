// node --test workers/amy-bo/index.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const env = { PAGES_ORIGIN: 'https://amybo-4p1.pages.dev', SITE: 'https://amybo.org' };
const calls = [];
globalThis.fetch = async (req) => {
	calls.push(req.url);
	const u = new URL(req.url);
	if (u.pathname === '/~martin') return new Response(null, { status: 308, headers: { location: '/~martin/' } });
	if (u.pathname === '/~martin/go/x') return new Response(null, { status: 302, headers: { location: 'https://patreon.com/AMYBO' } });
	if (u.pathname === '/links/go/nope') return new Response(null, { status: 302, headers: { location: 'https://amybo-4p1.pages.dev/links' } });
	return new Response(`page ${u.pathname}`, { status: 200, headers: { 'content-type': 'text/html' } });
};
const get = (path, host = 'amy.bo') => worker.fetch(new Request(`https://${host}${path}`), env);

test('short links', async () => {
	assert.equal((await get('/Forum/')).headers.get('location'), 'https://forum.amybo.org/');
	assert.equal((await get('/media')).status, 302);
	assert.equal((await get('/~gerrit')).headers.get('location'), 'https://gerritniezen.com/');
});
test('link pages are proxied and keep the amy.bo address', async () => {
	const r = await get('/~martin/');
	assert.equal(r.status, 200);
	assert.equal(await r.text(), 'page /~martin/');
	assert.equal(calls.at(-1), 'https://amybo-4p1.pages.dev/~martin/');
	assert.equal((await get('/links')).status, 200);
	assert.equal((await get('/link-media/martin-currie.jpg')).status, 200);
});
test('redirects from the Pages project stay on amy.bo', async () => {
	assert.equal((await get('/~martin')).headers.get('location'), 'https://amy.bo/~martin/');
	assert.equal((await get('/links/go/nope')).headers.get('location'), 'https://amy.bo/links');
	assert.equal((await get('/~martin/go/x')).headers.get('location'), 'https://patreon.com/AMYBO');
});
test('the editor lives on the main site', async () => {
	assert.equal((await get('/links/edit/')).headers.get('location'), 'https://amybo.org/links/edit/');
});
test('www and everything else', async () => {
	assert.equal((await get('/~martin', 'www.amy.bo')).headers.get('location'), 'https://amy.bo/~martin');
	assert.equal((await get('/about')).headers.get('location'), 'https://amybo.org/about');
	assert.equal((await get('/whatever')).headers.get('location'), 'https://amybo.org/whatever');
});
test('amy.bo/event is the next event, temporarily', async () => {
	const r = await get('/event');
	assert.equal(r.status, 302);
	assert.equal(r.headers.get('location'), 'https://amybo.org/events/2026-11-13-london/');
});
