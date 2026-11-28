// Remote access (amybo.org/remote): the real src/remote/ code against an in-memory SQLite stand-in for D1 with every
// migration applied, emails caught by the dev outbox, and a fake Cloudflare API for the Access policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { d1 } from './helpers/d1.mjs';

register('./helpers/ts-resolve.mjs', import.meta.url);
const core = await import('../src/remote/core.ts');
const access = await import('../src/remote/access.ts');
const server = await import('../src/remote/server.ts');

const MIGRATIONS = new URL('../eventsandeye/migrations/', import.meta.url);
const ACCOUNT = 'a'.repeat(32);
const APP = '11111111-2222-3333-4444-555555555555';
const ADMIN_APP_AUD = 'admin-aud-tag';
// Cloudflare's published Turnstile test keys (always passes, always fails) and a key for signing links in tests only.
const PASS = ['1x', '0'.repeat(31), 'AA'].join(''), FAIL = ['2x', '0'.repeat(31), 'AA'].join(''), LINK_KEY = 'unit-'.repeat(8);

function setup(extra = {}) {
	const DB = d1();
	for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) DB.raw.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
	return {
		DB, DEV_MODE: 'true', TOKEN_SECRET: LINK_KEY, TURNSTILE_SECRET_KEY: PASS,
		REGISTER_MIN_MS: '0', ADMIN_EMAILS: 'hello@amybo.org', SITE_URL: 'https://amybo.org', NOTIFY_EMAIL: 'hello@amybo.org', ACCESS_AUD: ADMIN_APP_AUD, ORG_NAME: 'AMYBO', ...extra,
	};
}
async function call(env, fn, body, method = 'POST') {
	const request = new Request('https://amybo.org/api/remote/x', { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
	const res = await fn({ env, request, data: {} });
	return { status: res.status, data: await res.json() };
}
const outbox = (env, to) => env.DB.raw.prepare('SELECT to_addr, subject, text_body FROM dev_outbox WHERE to_addr = ? ORDER BY id').all(to);
const tokenIn = (text, purpose) => new RegExp(`/remote/${purpose}/\\?t=(\\S+)`).exec(text)?.[1];
const row = (env, email) => env.DB.raw.prepare('SELECT * FROM remote_applications WHERE email = ?').get(email);
const glasgow = (env) => env.DB.raw.prepare(`SELECT * FROM remote_experiments WHERE name = 'Glasgow 2026'`).get();
const form = (over = {}) => ({ name: 'Sam Student', email: 'sam@example.ac.uk', institution: 'University of Glasgow, Alternative Protein', experiment: 'other', experiment_other: 'Glasgow 2026', reason: 'To run the growth experiment from home.', consent: true, 'cf-turnstile-response': 'ok', ...over });

/** Applies and confirms; returns the application row. */
async function confirmed(env, email = 'sam@example.ac.uk') {
	assert.equal((await call(env, server.postApply, form({ email }))).status, 200);
	const t = tokenIn(outbox(env, email).at(-1).text_body, 'confirm');
	assert.equal((await call(env, server.postConfirm, { t })).status, 200);
	return row(env, email);
}

/** A fake Cloudflare API holding one Access application with a reusable policy. */
function fakeCloudflare({ hosts = ['remote-glasgow.amybo.org'], aud = 'pi-aud', policies, appCount = 1 } = {}) {
	const state = {
		calls: [],
		policy: { id: 'pol-1', name: 'AMYBO remote: assigned people', decision: 'allow', reusable: true, app_count: appCount, uid: 'pol-1', created_at: 'x', updated_at: 'x',
			include: [{ email: { email: 'hello@amybo.org' } }, { email_domain: { domain: 'kept.example' } }], exclude: [], require: [{ login_method: { id: 'otp' } }], session_duration: '24h' },
	};
	const app = () => ({ id: APP, aud, domain: hosts[0], self_hosted_domains: hosts, destinations: hosts.map((h) => ({ type: 'public', uri: h })), policies: policies ?? [{ id: state.policy.id, name: state.policy.name, decision: 'allow', reusable: true }] });
	const ok = (result) => new Response(JSON.stringify({ success: true, result, errors: [] }), { headers: { 'content-type': 'application/json' } });
	globalThis.fetch = async (url, init = {}) => {
		const u = new URL(String(url));
		assert.equal(u.origin, 'https://api.cloudflare.com', `only Cloudflare's API is called, not ${u.origin}`);
		assert.equal(init.headers.authorization, 'Bearer cf-token');
		const path = u.pathname.replace(`/client/v4/accounts/${ACCOUNT}`, '');
		state.calls.push(`${init.method} ${path}`);
		if (init.method === 'GET' && path === `/access/apps/${APP}`) return ok(app());
		if (init.method === 'GET' && path === '/access/policies/pol-1') return ok(state.policy);
		if (init.method === 'PUT' && path === '/access/policies/pol-1') {
			const body = JSON.parse(init.body);
			state.lastPut = body;
			state.policy = { ...state.policy, ...body };
			return ok(state.policy);
		}
		return new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: 'not found' }] }), { status: 404 });
	};
	return state;
}
const apiEnv = (extra = {}) => setup({ CF_ACCESS_API_TOKEN: 'cf-token', CF_ACCOUNT_ID: ACCOUNT, ...extra });
const saveGlasgow = (env, over = {}) => {
	const e = glasgow(env);
	return call(env, server.postAdmin, { action: 'experiment.save', id: e.id, name: e.name, hostname: e.hostname, status: 'open', ends_on: '2099-12-18', access_app_id: '', offered: true, ...over });
};

test('the form: consent, a valid address and the required fields; only listed experiments', () => {
	assert.throws(() => core.checkApplication(form({ consent: false }), []), /consent/);
	assert.throws(() => core.checkApplication(form({ email: 'nope' }), []), /valid email/);
	assert.throws(() => core.checkApplication(form({ institution: '  ' }), []), /study or work/);
	assert.throws(() => core.checkApplication(form({ reason: '' }), []), /why/);
	assert.throws(() => core.checkApplication(form({ experiment: '7' }), [1]), /from the list/);
	const ok = core.checkApplication(form({ email: ' Sam@Example.AC.UK ', name: 'Sam\n Student', experiment: '1' }), [1]);
	assert.deepEqual([ok.email, ok.name, ok.wish_experiment_id], ['sam@example.ac.uk', 'Sam Student', 1]);
});

test('host names, dates and application ids are checked; two levels below the zone is warned about', () => {
	assert.equal(core.checkHostname('https://Remote-Glasgow.amybo.org/'), 'remote-glasgow.amybo.org');
	for (const bad of ['amybo.org', 'bad host.amybo.org', '-x.amybo.org', '']) assert.throws(() => core.checkHostname(bad), /host name/, bad);
	assert.equal(core.hostnameWarning('remote-glasgow.amybo.org'), null);
	assert.match(core.hostnameWarning('glasgow.remote.amybo.org'), /glasgow-remote\.amybo\.org/);
	assert.equal(core.checkDate('2026-12-18'), '2026-12-18');
	assert.throws(() => core.checkDate('2026-02-30'), /date/);
	assert.equal(core.checkAppId(APP.toUpperCase()), APP);
	assert.throws(() => core.checkAppId('../admin'), /Application ID/);
});

test('who is let in: the admins always; assigned people only while open and up to the last day (UK date)', () => {
	const admins = ['hello@amybo.org'];
	assert.deepEqual(core.allowList({ status: 'planned', ends_on: null }, ['b@x.org'], admins), admins);
	assert.deepEqual(core.allowList({ status: 'open', ends_on: null }, ['B@x.org', 'a@x.org'], admins), ['a@x.org', 'b@x.org', 'hello@amybo.org']);
	const lastDay = { status: 'open', ends_on: '2026-12-18' };
	assert.equal(core.letsPeopleIn(lastDay, new Date('2026-12-18T23:30:00Z')), true, '23:30 UTC is still the 18th in London in winter');
	assert.equal(core.letsPeopleIn(lastDay, new Date('2026-12-19T00:30:00Z')), false);
	assert.equal(core.letsPeopleIn({ status: 'closed', ends_on: null }), false);
});

test('the migration is idempotent and offers the Glasgow course on the form', async () => {
	const env = setup();
	env.DB.raw.exec(readFileSync(new URL('0014_remote_access.sql', MIGRATIONS), 'utf8'));
	assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM remote_experiments').get().n, 1);
	const r = await call(env, server.getExperiments, undefined, 'GET');
	assert.deepEqual(r.data.experiments.map((e) => [e.name, e.status]), [['Glasgow 2026', 'planned']]);
	assert.ok(!('hostname' in r.data.experiments[0]), 'the public list does not give the Pi\'s address away');
});

test('applying: a confirm email, double opt-in, the organisers told only once it is confirmed', async () => {
	const env = setup();
	const r = await call(env, server.postApply, form({ experiment: String(glasgow(env).id) }));
	assert.deepEqual(r, { status: 200, data: { ok: true } });
	assert.equal(row(env, 'sam@example.ac.uk').status, 'unconfirmed');
	assert.equal(outbox(env, 'hello@amybo.org').length, 0, 'no notification for an unconfirmed address');
	const mail = outbox(env, 'sam@example.ac.uk');
	assert.equal(mail.length, 1);
	assert.match(mail[0].subject, /Confirm your AMYBO remote access application/);
	const t = tokenIn(mail[0].text_body, 'confirm');
	assert.ok(t);
	assert.equal((await call(env, server.postConfirm, { t: t + 'x' })).status, 404, 'a tampered link is refused');
	assert.equal((await call(env, server.postWithdraw, { t: t.replace(/\.[^.]+$/, '.AAAA') })).data.already, true, 'a forged withdraw link deletes nothing');
	assert.ok(row(env, 'sam@example.ac.uk'));
	const c = await call(env, server.postConfirm, { t });
	assert.deepEqual(c.data, { ok: true, already: false });
	assert.equal(row(env, 'sam@example.ac.uk').status, 'pending');
	const note = outbox(env, 'hello@amybo.org');
	assert.equal(note.length, 1);
	assert.match(note[0].text_body, /Sam Student \(University of Glasgow, Alternative Protein\) has applied for remote access, for Glasgow 2026/);
	assert.equal((await call(env, server.postConfirm, { t })).data.already, true);
	// Applying again with a confirmed address: the same answer, nothing sent, nothing changed.
	assert.deepEqual((await call(env, server.postApply, form({ reason: 'changed' }))).data, { ok: true });
	assert.equal(outbox(env, 'sam@example.ac.uk').length, 1);
	assert.equal(row(env, 'sam@example.ac.uk').reason, 'To run the growth experiment from home.');
});

test('spam protection: honeypot, Turnstile with its own action, consent, and capped resends', async () => {
	const env = setup();
	assert.deepEqual((await call(env, server.postApply, form({ website: 'http://spam' }))).data, { ok: true });
	assert.equal(row(env, 'sam@example.ac.uk'), undefined, 'the honeypot stores nothing');
	assert.equal((await call(env, server.postApply, form({ 'cf-turnstile-response': '' }))).status, 403);
	assert.equal((await call(env, server.postApply, form({ consent: false }))).status, 400);
	assert.equal((await call(setup({ TURNSTILE_SECRET_KEY: FAIL }), server.postApply, form())).status, 403, 'a failing Turnstile check');
	for (let i = 0; i < 6; i++) await call(env, server.postApply, form());
	assert.equal(outbox(env, 'sam@example.ac.uk').length, 1 + core.MAX_RESENDS, 'an unconfirmed address gets a few confirm emails, then no more');
	assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM remote_applications').get().n, 1);
	const bad = await call(env, server.postApply, form({ email: 'x@y.org', experiment: '999' }));
	assert.equal(bad.status, 400);
	assert.equal(bad.data.field, 'experiment');
});

test('assigning without the Cloudflare API: the list to paste, and access links only once it is pasted', async () => {
	const env = setup();
	const app = await confirmed(env);
	const exp = glasgow(env);
	let r = await call(env, server.postAdmin, { action: 'application.assign', id: app.id, experiment_id: exp.id });
	assert.equal(r.status, 200);
	assert.equal(r.data.access.mode, 'manual');
	assert.deepEqual(r.data.access.emails, ['hello@amybo.org'], 'a planned experiment lets only the admins in');
	assert.equal(r.data.emailed, 0);
	r = await saveGlasgow(env);
	assert.deepEqual(r.data.access.emails, ['hello@amybo.org', 'sam@example.ac.uk']);
	assert.equal(r.data.access.inSync, false);
	r = await call(env, server.postAdmin, { action: 'experiment.email_links', id: exp.id });
	assert.equal(r.status, 409, 'no links until the policy has the new list');
	assert.equal((await call(env, server.postAdmin, { action: 'experiment.mark_synced', id: exp.id })).status, 200);
	r = await call(env, server.postAdmin, { action: 'experiment.email_links', id: exp.id });
	assert.equal(r.data.sent, 1);
	const mail = outbox(env, 'sam@example.ac.uk').at(-1);
	assert.match(mail.subject, /Your remote access: Glasgow 2026/);
	assert.match(mail.text_body, /https:\/\/remote-glasgow\.amybo\.org\//);
	assert.ok(tokenIn(mail.text_body, 'withdraw'), 'with a withdraw link');
	assert.equal((await call(env, server.postAdmin, { action: 'experiment.email_links', id: exp.id })).data.sent, 0, 'nobody is emailed twice');
	// Unconfirmed applications cannot be assigned.
	await call(env, server.postApply, form({ email: 'new@example.org' }));
	assert.equal((await call(env, server.postAdmin, { action: 'application.assign', id: row(env, 'new@example.org').id, experiment_id: exp.id })).status, 409);
});

test('with the Cloudflare API: the policy gets exactly the allow list, keeps its other settings, and the person is emailed', async () => {
	const cf = fakeCloudflare();
	const env = apiEnv();
	const app = await confirmed(env);
	const exp = glasgow(env);
	assert.equal((await saveGlasgow(env, { access_app_id: APP })).data.access.inSync, true);
	assert.deepEqual(access.emailsOf(cf.policy.include), ['hello@amybo.org']);
	const r = await call(env, server.postAdmin, { action: 'application.assign', id: app.id, experiment_id: exp.id });
	assert.equal(r.data.access.mode, 'api');
	assert.equal(r.data.access.inSync, true);
	assert.deepEqual(r.data.access.others, ['email_domain'], 'other rules are reported');
	assert.equal(r.data.emailed, 1);
	assert.deepEqual(access.emailsOf(cf.policy.include), ['hello@amybo.org', 'sam@example.ac.uk']);
	assert.deepEqual(cf.lastPut.require, [{ login_method: { id: 'otp' } }], 'require rules kept');
	assert.equal(cf.lastPut.session_duration, '24h');
	assert.ok(cf.lastPut.include.some((x) => x.email_domain), 'non-email include rules kept');
	for (const k of ['id', 'uid', 'created_at', 'updated_at', 'app_count', 'reusable']) assert.ok(!(k in cf.lastPut), `read-only ${k} not sent`);
	assert.match(outbox(env, 'sam@example.ac.uk').at(-1).subject, /Your remote access/);
	// Unassign, reject, withdraw: each takes them off at once.
	await call(env, server.postAdmin, { action: 'application.unassign', id: app.id });
	assert.deepEqual(access.emailsOf(cf.policy.include), ['hello@amybo.org']);
	await call(env, server.postAdmin, { action: 'application.assign', id: app.id, experiment_id: exp.id });
	await call(env, server.postAdmin, { action: 'application.reject', id: app.id });
	assert.equal(row(env, 'sam@example.ac.uk').status, 'rejected');
	assert.deepEqual(access.emailsOf(cf.policy.include), ['hello@amybo.org']);
	await call(env, server.postAdmin, { action: 'application.assign', id: app.id, experiment_id: exp.id });
	const t = tokenIn(outbox(env, 'sam@example.ac.uk').at(-1).text_body, 'withdraw');
	assert.deepEqual((await call(env, server.postWithdraw, { t })).data, { ok: true, already: false });
	assert.equal(row(env, 'sam@example.ac.uk'), undefined, 'withdrawing deletes the application');
	assert.deepEqual(access.emailsOf(cf.policy.include), ['hello@amybo.org']);
	// Closing the experiment leaves only the admins.
	await call(env, server.postAdmin, { action: 'application.assign', id: (await confirmed(env, 'two@example.org')).id, experiment_id: exp.id });
	assert.deepEqual(access.emailsOf(cf.policy.include), ['hello@amybo.org', 'two@example.org']);
	await saveGlasgow(env, { access_app_id: APP, status: 'closed' });
	assert.deepEqual(access.emailsOf(cf.policy.include), ['hello@amybo.org']);
});

test('the sync refuses the admin pages\' application, an application for another host, and a shared policy', async () => {
	const env = apiEnv();
	const exp = glasgow(env);
	fakeCloudflare({ aud: ADMIN_APP_AUD });
	let r = await saveGlasgow(env, { access_app_id: APP });
	assert.match(r.data.access.error, /admin pages/);
	fakeCloudflare({ hosts: ['other.amybo.org'] });
	r = await call(env, server.postAdmin, { action: 'experiment.sync', id: exp.id });
	assert.match(r.data.access.error, /protects other\.amybo\.org, not remote-glasgow\.amybo\.org/);
	let cf = fakeCloudflare({ appCount: 3 });
	r = await call(env, server.postAdmin, { action: 'experiment.sync', id: exp.id });
	assert.match(r.data.access.error, /used by 3 applications/);
	assert.ok(!cf.calls.some((c) => c.startsWith('PUT')), 'nothing written');
	cf = fakeCloudflare({ policies: [{ id: 'p1', name: 'One', decision: 'allow' }, { id: 'p2', name: 'Two', decision: 'allow' }] });
	r = await call(env, server.postAdmin, { action: 'experiment.sync', id: exp.id });
	assert.match(r.data.access.error, /name the one for this experiment "AMYBO remote"/);
	assert.match(glasgow(env).sync_error, /AMYBO remote/, 'the failure is shown on the admin page');
	const noAudit = await call(apiEnv({ CF_ACCOUNT_ID: 'bad' }), server.postAdmin, { action: 'experiment.sync', id: exp.id });
	assert.equal(noAudit.data.access.mode, 'manual', 'without a valid account id nothing is sent');
});

test('deletion: unconfirmed after 3 days; the rest 30 days after the course ends; people taken off when it ends', async () => {
	const cf = fakeCloudflare();
	const env = apiEnv();
	const exp = glasgow(env);
	await saveGlasgow(env, { access_app_id: APP, ends_on: '2026-12-18' });
	const now = new Date('2026-12-10T12:00:00Z');
	const app = await confirmed(env);
	await call(env, server.postAdmin, { action: 'application.assign', id: app.id, experiment_id: exp.id });
	await call(env, server.postApply, form({ email: 'late@example.org' }));
	env.DB.raw.prepare(`UPDATE remote_applications SET created_at = '2026-12-01T00:00:00Z' WHERE email = 'late@example.org'`).run();
	await call(env, server.postApply, form({ email: 'nocourse@example.org' }));
	env.DB.raw.prepare(`UPDATE remote_applications SET status = 'pending', wish_experiment_id = NULL, created_at = '2026-07-01T00:00:00Z' WHERE email = 'nocourse@example.org'`).run();
	assert.equal(core.deleteFrom(row(env, 'sam@example.ac.uk'), glasgow(env)), '2027-01-18');

	let r = await server.purge(env, now);
	assert.equal(r.unconfirmed, 1, 'the unconfirmed one, 9 days old');
	assert.equal(r.ended, 0, 'nothing is 180 days old yet, and the course has not ended');
	assert.ok(row(env, 'sam@example.ac.uk'));
	assert.ok(row(env, 'nocourse@example.org'));

	// The day after the last day: still kept, but no longer let in.
	r = await server.purge(env, new Date('2026-12-19T12:00:00Z'));
	assert.equal(r.synced, 1);
	assert.deepEqual(access.emailsOf(cf.policy.include), ['hello@amybo.org']);
	assert.ok(row(env, 'sam@example.ac.uk'));
	r = await server.purge(env, new Date('2027-01-17T12:00:00Z'));
	assert.equal(r.ended, 1, 'the application with no course, 180 days on');
	assert.ok(row(env, 'sam@example.ac.uk'), 'kept until 30 days after the course');
	r = await server.purge(env, new Date('2027-01-18T12:00:00Z'));
	assert.equal(r.ended, 1);
	assert.equal(row(env, 'sam@example.ac.uk'), undefined);
	assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM remote_applications').get().n, 0);
	// Nothing left to change: no more calls.
	const before = cf.calls.length;
	await server.purge(env, new Date('2027-01-19T12:00:00Z'));
	assert.equal(cf.calls.length, before);
});

test('links in emails cannot be reused across purposes or with Events&I', async () => {
	const env = setup();
	const t = await server.makeToken(env, 'confirm', 'abcdefghijklmnopqrstuv');
	assert.equal(await server.readToken(env, 'confirm', t), 'abcdefghijklmnopqrstuv');
	assert.equal(await server.readToken(env, 'withdraw', t), null);
	const { makeToken: eventsToken } = await import('../eventsandeye/src/tokens.ts');
	assert.equal(await server.readToken(env, 'confirm', await eventsToken(env, 'confirm', 'abcdefghijklmnopqrstuv')), null);
	assert.equal(await server.readToken(env, 'confirm', t, Date.now() + 4 * 86400_000), null, 'confirm links last 3 days');
});

test('admin actions are checked', async () => {
	const env = setup();
	const exp = glasgow(env);
	assert.equal((await call(env, server.postAdmin, { action: 'nope' })).status, 400);
	assert.equal((await call(env, server.postAdmin, { action: 'experiment.save', name: 'Two', hostname: exp.hostname, status: 'open' })).status, 409, 'one experiment per address');
	assert.equal((await call(env, server.postAdmin, { action: 'experiment.save', name: 'Two', hostname: 'two.amybo.org', status: 'maybe' })).status, 400);
	const r = await call(env, server.postAdmin, { action: 'experiment.save', name: 'Two', hostname: 'two.amybo.org', status: 'open', ends_on: '2027-01-31', offered: false });
	assert.equal(r.status, 200);
	assert.deepEqual((await call(env, server.getExperiments, undefined, 'GET')).data.experiments.map((e) => e.name), ['Glasgow 2026'], 'not offered on the form');
	assert.equal((await call(env, server.postAdmin, { action: 'application.assign', id: 'missing', experiment_id: exp.id })).status, 404);
});
