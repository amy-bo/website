#!/usr/bin/env node
/**
 * End-to-end test of the RSVP system against a local D1 database with `wrangler pages dev`.
 * Emails go to the dev outbox (DEV_MODE), Turnstile uses Cloudflare's always-pass test secret, and the admin
 * tests mint their own Access JWTs with a throwaway RSA key.
 *
 *   npm run build && npm run test:e2e
 */
import { spawn, execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign, randomUUID, randomBytes } from 'node:crypto';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const PERSIST = '.wrangler/e2e-state';
const EVENT = '2026-11-13-london';
const TOUR1 = '2026-11-13-london-1030';
const TOUR2 = '2026-11-13-london-1115';

if (!existsSync('dist/index.html')) {
	console.error('Run `npm run build` first.');
	process.exit(1);
}

// ---- keys and .dev.vars ----
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256' };
const devVarsBackup = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : null;
writeFileSync('.dev.vars', [
	'DEV_MODE=true',
	`SITE_URL=${BASE}`,
	`TOKEN_SECRET=${randomBytes(32).toString('hex')}`,
	'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
	'ACCESS_AUD=e2e-aud',
	'ACCESS_TEAM_DOMAIN=e2e.cloudflareaccess.com',
	`ACCESS_JWKS_JSON=${JSON.stringify({ keys: [jwk] })}`,
	'',
].join('\n'));

const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt({ key = privateKey, kid = 'e2e', aud = 'e2e-aud', exp = Math.floor(Date.now() / 1000) + 600, email = 'admin@example.org' } = {}) {
	const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
	const p = b64u(JSON.stringify({ aud: [aud], email, exp, iat: Math.floor(Date.now() / 1000), iss: 'https://e2e.cloudflareaccess.com' }));
	return `${h}.${p}.${b64u(sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key))}`;
}
const ADMIN = { 'cf-access-jwt-assertion': jwt() };

// ---- fresh local database ----
rmSync(PERSIST, { recursive: true, force: true });
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'amybo-rsvp', '--local', '--persist-to', PERSIST], { stdio: 'inherit', env: { ...process.env, CI: '1' } });

// ---- server ----
const server = spawn('npx', ['wrangler', 'pages', 'dev', './dist', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST], {
	stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' }, detached: true,
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

let failures = 0, passes = 0;
function check(name, cond, detail = '') {
	if (cond) { passes++; console.log(`  ✓ ${name}`); }
	else { failures++; console.log(`  ✗ ${name}${detail ? ` – ${detail}` : ''}`); }
}
async function req(method, path, body, headers = {}) {
	const res = await fetch(BASE + path, {
		method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
		body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual',
	});
	const text = await res.text();
	let data; try { data = JSON.parse(text); } catch { data = text; }
	return { status: res.status, data, headers: res.headers };
}
const outbox = async () => (await req('GET', '/api/dev/outbox')).data.emails;
const mailsTo = async (to) => (await outbox()).filter((e) => e.to_addr === to);
const tokenFrom = (text, kind) => {
	const m = new RegExp(`/events/${kind}/\\?t=([^\\s"&<]+)`).exec(text);
	return m ? decodeURIComponent(m[1]) : null;
};
const register = (over = {}) => req('POST', '/api/rsvp/register', {
	event: EVENT, name: 'Test Person', email: `${randomUUID()}@example.org`, attendance: 'in_person', tour_id: 'none',
	consent: true, website: '', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...over,
});
const cron = (atMs) => req('POST', `/api/dev/cron${atMs ? `?at=${new Date(atMs).toISOString()}` : ''}`);

async function waitReady() {
	try { await fetch(`${BASE}/`); throw new Error(`Port ${PORT} is already in use: stop the other server first.`); } catch (e) { if (String(e.message).startsWith('Port')) throw e; }
	for (let i = 0; i < 120; i++) {
		try { const r = await fetch(`${BASE}/api/rsvp/status?event=${EVENT}`); if (r.status < 500) return; } catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`wrangler pages dev did not start:\n${serverLog.slice(-3000)}`);
}

try {
	await waitReady();
	console.log('\nPublic pages');
	for (const p of ['/', '/events/2026-11-13-london/', '/privacy/', '/events/confirm/', '/events/manage/', '/docs/overview/', '/about/']) {
		const r = await fetch(BASE + p);
		check(`GET ${p} → 200`, r.status === 200, String(r.status));
	}

	console.log('\nAdmin protection (Cloudflare Access JWT)');
	for (const p of ['/admin/rsvps/', `/api/admin/summary?event=${EVENT}`, `/api/admin/export?format=csv&event=${EVENT}`, `/api/admin/sent-log?event=${EVENT}`]) {
		check(`${p} without JWT → 401`, (await req('GET', p)).status === 401);
		check(`${p} with JWT signed by wrong key → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ key: otherKey }) })).status === 401);
		check(`${p} with wrong audience → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ aud: 'someone-else' }) })).status === 401);
		check(`${p} with expired JWT → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ exp: Math.floor(Date.now() / 1000) - 3600 }) })).status === 401);
		check(`${p} with garbage JWT → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': 'a.b.c' })).status === 401);
		check(`${p} with valid JWT → 200`, (await req('GET', p, undefined, ADMIN)).status === 200);
	}
	check('admin POST without JWT → 401', (await req('POST', '/api/admin/settings', { event: EVENT, in_person_max: 999 })).status === 401);
	check('admin POST from another origin → 403', (await req('POST', '/api/admin/settings', { event: EVENT }, { ...ADMIN, origin: 'https://evil.example' })).status === 403);

	console.log('\nSettings: in-person max 1, each tour 1 place');
	let r = await req('POST', '/api/admin/settings', { event: EVENT, in_person_max: 1, tours: [{ id: TOUR1, capacity: 1 }, { id: TOUR2, capacity: 1 }] }, ADMIN);
	check('settings saved', r.status === 200 && r.data.ok, JSON.stringify(r.data));
	r = await req('GET', `/api/rsvp/status?event=${EVENT}`);
	check('status shows open with places', r.data.ok && r.data.event.open && r.data.in_person_available === true);

	console.log('\nValidation and spam protection');
	const before = (await outbox()).length;
	check('missing consent → 400', (await register({ consent: false })).status === 400);
	check('bad email → 400', (await register({ email: 'not-an-email' })).status === 400);
	check('missing Turnstile token → 403', (await register({ 'cf-turnstile-response': '' })).status === 403);
	r = await register({ website: 'http://spam.example', email: 'bot@example.org' });
	check('honeypot → fake success', r.status === 200 && r.data.ok);
	check('honeypot and rejects send no email', (await outbox()).length === before);
	check('non-JSON body → 415', (await fetch(`${BASE}/api/rsvp/register`, { method: 'POST', body: 'name=x' })).status === 415);

	console.log('\nCreate → confirm (place) and waiting list');
	const alice = 'alice@example.org', bob = 'bob@example.org';
	r = await register({ name: 'Alice', email: alice, tour_id: TOUR1, affiliation: 'Lab A', needs: 'Vegan' });
	check('Alice registers', r.status === 200 && r.data.ok, JSON.stringify(r.data));
	let mails = await mailsTo(alice);
	check('Alice gets one confirm-your-email message', mails.length === 1 && /Complete your registration/.test(mails[0].subject));
	check('confirm email says registration is not complete', /NOT COMPLETE YET/.test(mails[0].text_body) && /Complete registration/.test(mails[0].html_body));
	const aliceConfirm = tokenFrom(mails[0].text_body, 'confirm');
	const aliceManage = tokenFrom(mails[0].text_body, 'manage');
	check('confirm and manage links present', !!aliceConfirm && !!aliceManage);

	r = await register({ name: 'Bob', email: bob, tour_id: TOUR1 });
	check('Bob registers while Alice holds the only place', r.data.ok);
	const bobMail = (await mailsTo(bob))[0];
	const bobConfirm = tokenFrom(bobMail.text_body, 'confirm');
	const bobManage = tokenFrom(bobMail.text_body, 'manage');

	check('confirm via GET does nothing (link scanners)', [404, 405].includes((await req('GET', `/api/rsvp/confirm?t=${encodeURIComponent(aliceConfirm)}`)).status));
	check('tampered confirm token → 404', (await req('POST', '/api/rsvp/confirm', { t: aliceConfirm.slice(0, -2) + 'xx' })).status === 404);
	check('manage token cannot confirm', (await req('POST', '/api/rsvp/confirm', { t: aliceManage })).status === 404);
	r = await req('POST', '/api/rsvp/confirm', { t: aliceConfirm });
	check('Alice confirms → place + tour place', r.data.ok && r.data.registration.place === 'place' && r.data.registration.tour_place === 'place', JSON.stringify(r.data));
	mails = await mailsTo(alice);
	check('Alice receives joining instructions v1', mails.length === 2 && /Joining instructions/.test(mails[1].subject) && /You have an in-person place/.test(mails[1].text_body));
	r = await req('POST', '/api/rsvp/confirm', { t: aliceConfirm });
	check('confirming twice is idempotent and sends nothing more', r.data.ok && r.data.already === true && (await mailsTo(alice)).length === 2);

	r = await req('POST', '/api/rsvp/confirm', { t: bobConfirm });
	check('Bob confirms → in-person waiting list and tour waiting list', r.data.registration.place === 'waitlist' && r.data.registration.tour_place === 'waitlist', JSON.stringify(r.data));
	check('Bob gets no joining instructions while waiting', (await mailsTo(bob)).length === 1);
	let hello = await mailsTo('hello@amybo.org');
	check('hello@ told about the new waiting-list registration with totals', hello.some((m) => /waiting-list registration/.test(m.subject) && /In person: 1 confirmed of 1 places, 1 on the waiting list/.test(m.text_body)), hello.map((m) => m.subject).join(' | '));

	console.log('\nDuplicate registration');
	r = await register({ name: 'Alice again', email: alice });
	check('duplicate returns the same generic success', r.status === 200 && r.data.ok);
	mails = await mailsTo(alice);
	check('existing registrant is emailed their manage link, nothing else changes', mails.length === 3 && /already registered/.test(mails[2].text_body));

	console.log('\nSelf-service update');
	r = await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(aliceManage)}`);
	check('manage view', r.data.ok && r.data.registration.name === 'Alice' && r.data.registration.needs === 'Vegan');
	check('confirm token cannot manage', (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(aliceConfirm)}`)).status === 404);
	r = await req('POST', '/api/rsvp/manage', { t: aliceManage, name: 'Alice A', attendance: 'in_person', tour_id: TOUR2, affiliation: 'Lab A', needs: 'Vegan, step-free access' });
	check('Alice moves to the free 11:15 tour and edits details', r.data.ok && r.data.registration.tour_id === TOUR2 && r.data.registration.tour_place === 'place' && r.data.registration.name === 'Alice A', JSON.stringify(r.data));
	r = await req('GET', `/api/rsvp/status?event=${EVENT}`);
	check('freed 10:30 tour place is not offered while someone waits for it', r.data.tours.find((t) => t.id === TOUR1).available === false);

	console.log('\nAdmin: promote, instructions versions, messages');
	r = await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN);
	check('summary counts', r.data.capacity.inPerson.confirmed === 1 && r.data.capacity.inPerson.waiting === 1, JSON.stringify(r.data.capacity));
	const bobId = r.data.registrations.find((x) => x.email === bob).id;
	r = await req('POST', '/api/admin/promote', { id: bobId, what: 'tour' }, ADMIN);
	check('promote Bob to the 10:30 tour (still waiting for a place → no email yet)', r.data.ok && (await mailsTo(bob)).length === 1);
	r = await req('POST', '/api/admin/promote', { id: bobId, what: 'event' }, ADMIN);
	mails = await mailsTo(bob);
	check('promote Bob to an in-person place → joining instructions', r.data.ok && mails.length === 2 && /You have an in-person place/.test(mails[1].text_body) && /booked on the 10:30 lab tour/.test(mails[1].text_body));
	check('promoting again is refused', (await req('POST', '/api/admin/promote', { id: bobId, what: 'event' }, ADMIN)).status === 400);

	r = await req('POST', '/api/admin/instructions', { event: EVENT, subject: 'Joining instructions v2', body_md: 'Room **G01**, sign in at reception.\n\n- Bring ID', change_note: 'Added room' }, ADMIN);
	check('new instructions version 2', r.data.ok && r.data.version === 2);
	check('saving a version emails nobody', (await mailsTo(alice)).length === 3 && (await mailsTo(bob)).length === 2);
	r = await req('POST', '/api/admin/messages', { event: EVENT, dry_run: true, audience: { below_version: 2 } }, ADMIN);
	check('dry run: 2 people on an older version', r.data.count === 2, JSON.stringify(r.data));
	r = await req('POST', '/api/admin/messages', { event: EVENT, subject: 'Room confirmed', body_md: "What's changed: we are in room **G01**.", audience: { below_version: 2 }, marks_instructions_version: 2 }, ADMIN);
	check('send now', r.data.ok && r.data.message.status === 'sent' && r.data.message.recipients_count === 2, JSON.stringify(r.data));
	const aliceLast = (await mailsTo(alice)).at(-1);
	check('each recipient gets a personal copy with their manage link', /Hello Alice A/.test(aliceLast.text_body) && /<strong>G01<\/strong>/.test(aliceLast.html_body) && aliceLast.text_body.includes('/events/manage/?t='));
	r = await req('POST', '/api/admin/messages', { event: EVENT, dry_run: true, audience: { below_version: 2 } }, ADMIN);
	check('recipients now recorded as having version 2', r.data.count === 0);
	check('HTML in messages is escaped', !/<script>/.test((await req('POST', '/api/admin/preview', { body_md: '<script>alert(1)</script>' }, ADMIN)).data.html));

	const inAnHour = new Date(Date.now() + 3600_000).toISOString();
	r = await req('POST', '/api/admin/messages', { event: EVENT, subject: 'Reminder', body_md: 'See you soon', audience: { attendance: 'in_person' }, scheduled_at: inAnHour }, ADMIN);
	const schedId = r.data.message.id;
	check('schedule a message', r.data.message.status === 'scheduled');
	r = await req('POST', '/api/admin/messages', { event: EVENT, subject: 'To cancel', body_md: 'x', audience: {}, scheduled_at: inAnHour }, ADMIN);
	check('cancel a scheduled message', (await req('POST', '/api/admin/messages/cancel', { id: r.data.message.id }, ADMIN)).data.ok);
	const nBefore = (await outbox()).length;
	await cron(Date.now());
	check('cron does not send before the scheduled time', (await outbox()).length === nBefore);
	r = await cron(Date.now() + 2 * 3600_000);
	const reminder = (await outbox()).filter((m) => m.subject === 'Reminder');
	check('cron sends the due scheduled message once, cancelled one never', reminder.length === 2 && !(await outbox()).some((m) => m.subject === 'To cancel'), JSON.stringify(r.data));
	await cron(Date.now() + 3 * 3600_000);
	check('scheduled message is not sent twice', (await outbox()).filter((m) => m.subject === 'Reminder').length === 2);
	r = await req('GET', `/api/admin/messages?event=${EVENT}`, undefined, ADMIN);
	check('sent log lists sent, scheduled and cancelled messages', r.data.messages.some((m) => m.id === schedId && m.status === 'sent') && r.data.messages.some((m) => m.status === 'cancelled'));
	r = await req('GET', `/api/admin/sent-log?event=${EVENT}`, undefined, ADMIN);
	check('markdown sent log includes versions and messages', typeof r.data === 'string' && /Version 2/.test(r.data) && /Room confirmed/.test(r.data) && /Version 2: 2 confirmed/.test(r.data));

	console.log('\nExports');
	await register({ name: '=HYPERLINK("http://x")', email: 'formula@example.org', attendance: 'remote' });
	r = await req('GET', `/api/admin/export?format=csv&event=${EVENT}`, undefined, ADMIN);
	check('CSV has registrants and defuses formulas', typeof r.data === 'string' && /Alice A/.test(r.data) && /"'=HYPERLINK/.test(r.data), String(r.data).slice(0, 300));
	r = await req('GET', `/api/admin/export?format=bcc&event=${EVENT}&audience=${encodeURIComponent('{}')}`, undefined, ADMIN);
	check('BCC list has confirmed attendees only', r.data.count === 2 && r.data.bcc.includes(alice) && !r.data.bcc.includes('formula@'));

	console.log('\nUnconfirmed holds');
	const carol = 'carol@example.org';
	await register({ name: 'Carol', email: carol, attendance: 'remote' });
	const created = Date.now();
	r = await cron(created + 23 * 3600_000);
	check('before half the hold: no warning', !(await mailsTo('hello@amybo.org')).some((m) => /Carol/.test(m.text_body)));
	r = await cron(created + 25 * 3600_000);
	hello = await mailsTo('hello@amybo.org');
	check('after half the hold: hello@ warned once', hello.filter((m) => /half way/.test(m.subject) && /Carol/.test(m.text_body)).length === 1, JSON.stringify(r.data));
	await cron(created + 26 * 3600_000);
	check('warning not repeated', (await mailsTo('hello@amybo.org')).filter((m) => /half way/.test(m.subject) && /Carol/.test(m.text_body)).length === 1);
	r = await cron(created + 49 * 3600_000);
	const carolManage = tokenFrom((await mailsTo(carol))[0].text_body, 'manage');
	check('after the hold: unconfirmed registration deleted', (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(carolManage)}`)).status === 404, JSON.stringify(r.data));

	console.log('\nCancel');
	r = await req('DELETE', '/api/rsvp/manage', { t: aliceManage });
	check('Alice cancels', r.data.ok);
	check('Alice gets a cancellation confirmation', /Registration cancelled/.test((await mailsTo(alice)).at(-1).subject));
	check('hello@ notified of the cancellation', (await mailsTo('hello@amybo.org')).some((m) => /Cancellation/.test(m.subject) && /Alice A/.test(m.text_body)));
	check('Alice\'s row is gone', (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(aliceManage)}`)).status === 404);
	r = await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN);
	check('no delivery records remain for Alice (cascade)', !r.data.registrations.some((x) => x.email === alice));

	console.log('\nDeadline');
	r = await req('POST', '/api/admin/settings', { event: EVENT, deadline: new Date(Date.now() - 60_000).toISOString() }, ADMIN);
	check('deadline moved into the past', r.data.ok);
	check('registration refused after the deadline', (await register({ email: 'late@example.org' })).status === 409);
	check('status shows closed', (await req('GET', `/api/rsvp/status?event=${EVENT}`)).data.event.open === false);
	r = await req('POST', '/api/rsvp/manage', { t: bobManage, name: 'Bob', attendance: 'remote', tour_id: 'none' });
	check('existing registrant can still switch to remote after the deadline', r.data.ok && r.data.registration.attendance === 'remote');

	console.log('\nRetention');
	await cron(Date.parse('2026-11-13T22:00:00Z') + 29 * 24 * 3600_000);
	r = await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN);
	check('registrations kept until 30 days after the event', r.data.registrations.length > 0);
	await cron(Date.parse('2026-11-13T22:00:00Z') + 31 * 24 * 3600_000);
	r = await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN);
	check('all registrations deleted 30 days after the event', r.data.registrations.length === 0);
} catch (e) {
	failures++;
	console.error(e);
} finally {
	// Kill the whole process group: npx → wrangler → workerd, or workerd keeps the port.
	try { process.kill(-server.pid, 'SIGTERM'); } catch {}
	await new Promise((r) => setTimeout(r, 1500));
	try { process.kill(-server.pid, 'SIGKILL'); } catch {}
	if (devVarsBackup !== null) writeFileSync('.dev.vars', devVarsBackup); else rmSync('.dev.vars', { force: true });
}
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) {
	console.log('\n--- server log (tail) ---\n' + serverLog.slice(-4000));
	process.exit(1);
}
