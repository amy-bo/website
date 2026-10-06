// Unit tests for joining-instruction sections. Run: node --test eventsandeye/tests/audience.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/templates.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { forAudience, signedUpIds } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

const md = ['All', ':::in-person', 'Room', ':::', ':::remote', 'Meet', ':::', ':::only tour-a tour-b', 'Shoes', ':::', ':::only dinner', 'Pub', ':::', 'End'].join('\n');

test('mode sections still go to their own kind of attendee', () => {
	assert.equal(forAudience(md, 'in_person'), 'All\nRoom\nEnd');
	assert.equal(forAudience(md, 'remote'), 'All\nMeet\nEnd');
});

test('an :::only section goes to anyone signed up to one of its sessions, whichever way they attend', () => {
	assert.equal(forAudience(md, 'in_person', ['tour-b', 'dinner']), 'All\nRoom\nShoes\nPub\nEnd');
	assert.equal(forAudience(md, 'extras', ['dinner']), 'All\nPub\nEnd');
	assert.equal(forAudience(md, 'extras', ['tour-a']), 'All\nShoes\nEnd');
});

test('signed-up sessions: a tour only once there is a place on it; nothing for remote attendees', () => {
	assert.deepEqual(signedUpIds({ attendance: 'in_person', optins: 'dinner,sat', tour_id: 't1', tour_place: 'place' }), ['t1', 'dinner', 'sat']);
	assert.deepEqual(signedUpIds({ attendance: 'in_person', optins: null, tour_id: 't1', tour_place: 'waitlist' }), []);
	assert.deepEqual(signedUpIds({ attendance: 'remote', optins: 'dinner', tour_id: null, tour_place: null }), []);
});
