#!/usr/bin/env node
/**
 * End-to-end test of the link pages (amy.bo/~name, amy.bo/links) against a fresh local D1 database and
 * `wrangler pages dev ./dist`. Emails go to the dev outbox; admin calls carry Access JWTs minted with a throwaway key.
 * Run `npm run build:test` first. Restores .dev.vars afterwards.
 */
import { spawn, execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { existsSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const axeSource = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
async function axe(html, url) {
	const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url, virtualConsole: new VirtualConsole() });
	dom.window.eval(axeSource);
	const res = await dom.window.axe.run(dom.window.document, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: false } } });
	dom.window.close();
	return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 2).join(', ')}`);
}

const PORT = 8789;
const BASE = `http://127.0.0.1:${PORT}`;
const PERSIST = '.wrangler/links-e2e-state';
const DB = 'amybo-rsvp-eu';

if (!existsSync('dist/index.html')) {
	console.error('Run `npm run build:test` first.');
	process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256' };
const devVarsBackup = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : null;
writeFileSync(
	'.dev.vars',
	[
		'DEV_MODE=true',
		`SITE_URL=${BASE}`,
		`TOKEN_SECRET=${randomBytes(32).toString('hex')}`,
		'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
		'ACCESS_AUD=e2e-aud',
		'ACCESS_TEAM_DOMAIN=e2e.cloudflareaccess.com',
		'ADMIN_EMAILS=admin@example.org',
		`ACCESS_JWKS_JSON=${JSON.stringify({ keys: [jwk] })}`,
		'',
	].join('\n'),
);
const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt() {
	const now = Math.floor(Date.now() / 1000);
	const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'e2e', typ: 'JWT' }));
	const p = b64u(JSON.stringify({ aud: ['e2e-aud'], email: 'admin@example.org', exp: now + 600, iat: now, iss: 'https://e2e.cloudflareaccess.com', type: 'app', amr: ['pwd', 'mfa'] }));
	return `${h}.${p}.${b64u(sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey))}`;
}
const ADMIN = { 'cf-access-jwt-assertion': jwt(), origin: BASE };

const restoreDevVars = () => (devVarsBackup !== null ? writeFileSync('.dev.vars', devVarsBackup) : rmSync('.dev.vars', { force: true }));
process.on('exit', restoreDevVars);
rmSync(PERSIST, { recursive: true, force: true });
const wr = (args) => execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CI: '1' } });
wr(['d1', 'migrations', 'apply', DB, '--local', '--persist-to', PERSIST]);
for (const f of readdirSync('db/links').filter((f) => f.endsWith('.sql')).sort()) wr(['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--file', `db/links/${f}`]);
// Twice, as on every deploy: the schema and seeds must be safe to re-run.
for (const f of readdirSync('db/links').filter((f) => f.endsWith('.sql')).sort()) wr(['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--file', `db/links/${f}`]);

const server = spawn('npx', ['wrangler', 'pages', 'dev', './dist', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST, '--r2', 'LINKS_BUCKET'], {
	stdio: ['ignore', 'pipe', 'pipe'],
	env: { ...process.env, CI: '1' },
	detached: true,
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

let failures = 0;
let passes = 0;
function check(name, cond, detail = '') {
	if (cond) {
		passes++;
		console.log(`  ✓ ${name}`);
	} else {
		failures++;
		console.log(`  ✗ ${name}${detail ? ` – ${String(detail).slice(0, 500)}` : ''}`);
	}
}
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
async function req(method, path, body, headers = {}) {
	const res = await fetch(BASE + path, {
		method,
		headers: { 'user-agent': UA, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
		body: body !== undefined ? JSON.stringify(body) : undefined,
		redirect: 'manual',
	});
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { status: res.status, data, text, headers: res.headers };
}
const SAME = { origin: BASE, 'sec-fetch-site': 'same-origin' };
const outbox = async () => (await req('GET', '/api/dev/outbox')).data.emails;
const tokenIn = (text) => /#t=([A-Za-z0-9_-]+)/.exec(text)?.[1];
const lastTokenFor = async (addr) => {
	const ms = (await outbox()).filter((e) => e.to_addr === addr);
	return { count: ms.length, token: ms.length ? tokenIn(ms.at(-1).text_body) : null };
};
const cookieOf = (r) => /lp_s=([^;]+)/.exec(r.headers.get('set-cookie') || '')?.[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
	for (let i = 0; i < 120; i++) {
		try {
			const r = await fetch(`${BASE}/links`);
			if (r.status < 500) return;
		} catch {}
		await sleep(500);
	}
	throw new Error(`wrangler pages dev did not start:\n${serverLog.slice(-3000)}`);
}

try {
	await waitReady();

	console.log('\nPublic pages');
	{
		const r = await req('GET', '/~martin');
		check('/~martin renders', r.status === 200 && r.text.includes('Martin Currie') && r.text.includes('/~martin/go/patreon'), r.status);
		check('it has the twisty list, closed, and the static map', r.text.includes('<details name="l-root"><summary data-n=') && !r.text.includes('<details open') && r.text.includes('class="mapsvg"') && r.text.includes('/link-assets/graph.js'));
		check('the list is words only: no addresses, counts or icons', !r.text.includes('class="host"') && !r.text.includes('class="count"') && !/<nav[^]*?<svg[^]*?<\/nav>/.test(r.text));
		check('no instructions on the page', !/touch to explore|click to|tap to/i.test(r.text));
		check('one portrait only (the map\'s centre)', !r.text.includes('class="avatar"') && (r.text.match(/martin-currie\.jpg/g) || []).length === 1);
		check('a group with one link is just that link (Email)', /<a data-n="\d+" href="\/~martin\/go\/email">Email<\/a>/.test(r.text), (/.{0,80}go\/email.{0,40}/.exec(r.text) || [''])[0]);
		check('hovering one lights up the other (CSS only)', r.text.includes(':has([data-n=') && r.text.includes(':has([data-g='));
		const pics = JSON.parse(/<script type="application\/json" id="l-data">([^<]*)<\/script>/.exec(r.text)[1].replace(/\\u003c/g, '<')).nodes.map((n) => n.icon);
		check('every picture on the map is different', new Set(pics).size === pics.length, pics.join(' '));
		check('the email link asks for a "Contact Martin" heading', (await req('GET', '/~martin/go/email')).headers.get('location').includes('heading=Contact%20Martin'));
		check('the map uses the real logos', r.text.includes('/link-media/logo-andeye.png') || r.text.includes('/link-media/amybo.svg'));
		check('the footer sits outside the content, at the bottom', /<\/div>\s*<footer class="foot">/.test(r.text));
		check('no script runs a loop before the map is touched', !/requestAnimationFrame|setInterval/.test(r.text));
		check('Mastodon verification link', r.text.includes('<link rel="me" href="https://mas.to/@Aqueum">'));
		check('canonical address is on amy.bo', r.text.includes('<link rel="canonical" href="https://amy.bo/~martin">'));
		const a = await req('GET', '/links');
		check('/links is AMYBO\'s page', a.status === 200 && a.text.includes('Join the free bioreactor waitlist'), a.status);
		check('/~amybo → /links', (await req('GET', '/~amybo')).headers.get('location') === '/links');
		check('/~Martin → /~martin', (await req('GET', '/~Martin')).headers.get('location') === '/~martin');
		check('/~nobody → 404', (await req('GET', '/~nobody')).status === 404);
		check('/~bad..handle → 404', (await req('GET', '/~bad..handle')).status === 404);
		check('other site pages still serve', (await req('GET', '/about/')).status === 200);
		check('the editor is static', (await req('GET', '/links/edit/')).status === 200);
	}

	console.log('\nClicks');
	{
		const r = await req('GET', '/~martin/go/patreon');
		check('a link redirects to its target', r.status === 302 && r.headers.get('location') === 'https://patreon.com/AMYBO', r.headers.get('location'));
		const u = await req('GET', '/~martin/go/nope');
		check('an unknown link goes back to the page (relative)', u.status === 302 && u.headers.get('location') === '/~martin', u.headers.get('location'));
		await req('GET', '/~martin/go/qrz', undefined, { 'user-agent': 'curl/8.0' });
		await sleep(300);
		const s = await req('GET', '/admin/links/', undefined, ADMIN);
		check('seeded owner emails are placeholders, never real addresses', s.text.includes('martin@links.invalid') && s.text.includes('(placeholder)'));
		check('admin stats page opens with Access', s.status === 200 && s.text.includes('Link pages'), s.status);
		const row = /<tr><td>Patreon<\/td><td>(\d+)<\/td><td>(\d+)<\/td><td>(\d+)<\/td><td>7<\/td><td><b>(\d+)<\/b>/.exec(s.text);
		check('the click was counted, on top of the Linktree seed', row && row[3] === '1' && row[4] === '8', row?.[0]);
		check('a bot click was not counted', /<tr><td>MM7MMU on QRZ.com<\/td><td>0<\/td>/.test(s.text));
		check('admin page refuses without Access', (await req('GET', '/admin/links/')).status === 401);
	}

	console.log('\nInvitations and sign-in');
	let cookie;
	let lastSignin = 0;
	{
		const bad = await req('POST', '/api/admin/links/invite', { email: 'x@example.org', name: 'X', handle: 'admin', role: 'plain' }, ADMIN);
		check('reserved handles refused', bad.status === 400, bad.text);
		const dup = await req('POST', '/api/admin/links/invite', { email: 'other@example.org', name: 'X', handle: 'martin', role: 'plain' }, ADMIN);
		check('taken handles refused', dup.status === 400 && /taken/.test(dup.text), dup.text);
		const noauth = await req('POST', '/api/admin/links/invite', { email: 'v@example.org', name: 'Vee', handle: 'vee', role: 'both' }, { origin: BASE });
		check('invites need Access', noauth.status === 401, noauth.status);
		const ok = await req('POST', '/api/admin/links/invite', { email: 'Vee@Example.org', name: 'Vee Volunteer', handle: 'vee', role: 'both' }, ADMIN);
		check('invite sent', ok.status === 200, ok.text);
		const { token } = await lastTokenFor('vee@example.org');
		check('invite email carries a link with the token after #', !!token);
		check('an invited page is not public yet', (await req('GET', '/~vee')).status === 404);
		const pk = await req('POST', '/api/links/verify', { token, peek: true }, SAME);
		check('a link says whose page it is before it is used', pk.status === 200 && pk.data.handle === 'vee' && !cookieOf(pk), pk.text);
		const v = await req('POST', '/api/links/verify', { token }, SAME);
		cookie = cookieOf(v);
		check('the link signs them in', v.status === 200 && !!cookie, v.text);
		check('the session cookie is HttpOnly and SameSite', /HttpOnly/.test(v.headers.get('set-cookie')) && /SameSite=Lax/.test(v.headers.get('set-cookie')));
		const again = await req('POST', '/api/links/verify', { token }, SAME);
		check('a link works once', again.status === 400);
		check('and cannot be peeked at once used', (await req('POST', '/api/links/verify', { token, peek: true }, SAME)).status === 400);
		check('the page is public once they have signed in', (await req('GET', '/~vee')).status === 200);

		const before = (await outbox()).length;
		await req('POST', '/api/links/signin', { email: 'nobody@example.org' }, SAME);
		check('unknown addresses get no email (and the same answer)', (await outbox()).length === before);
		await req('POST', '/api/links/signin', { email: 'vee@example.org' }, SAME);
		lastSignin = Date.now();
		await req('POST', '/api/links/signin', { email: 'vee@example.org' }, SAME);
		await sleep(500);
		check('sign-in links are limited to one a minute', (await outbox()).length === before + 1);
		const c = await req('GET', '/~martin');
		const scriptSrc = /script-src[^;]*/.exec(c.headers.get('content-security-policy') || '')?.[0] || '';
		check('pages allow only their own inline script', /'sha256-[A-Za-z0-9+/=]+'/.test(scriptSrc) && !scriptSrc.includes('unsafe-inline'), scriptSrc);
		check('a malformed link address is a 404, not an error', (await req('GET', '/~martin/go/%E0%A4%A')).status === 404);
	}

	const C = { ...SAME, cookie: `lp_s=${cookie}` };
	console.log('\nEditing');
	{
		const me = await req('GET', '/api/links/me', undefined, { cookie: `lp_s=${cookie}` });
		check('me returns their page', me.status === 200 && me.data.person.handle === 'vee' && me.data.nodes.length === 2, me.text);
		const diary = me.data.nodes.find((n) => n.kind === 'diary');
		const support = me.data.nodes.find((n) => n.kind === 'support');
		const nodes = [
			{ id: diary.id, key: 'd', parent: null, kind: 'diary', label: 'AMYBO diary' },
			{ id: support.id, key: 's', parent: null, kind: 'support', label: 'How I support AMYBO', body: 'I print parts. **Lots** of parts.' },
			{ key: 'g', parent: null, kind: 'group', label: 'Projects' },
			{ key: 'l1', parent: 'g', kind: 'link', label: 'My <script>alert(1)</script> repo', url: 'https://github.com/vee', icon: 'github' },
			{ key: 'g2', parent: 'g', kind: 'group', label: 'Deeper' },
			{ key: 'l2', parent: 'g2', kind: 'link', label: 'Mail me', url: 'mailto:vee@example.org' },
		];
		check('no Origin is refused', (await req('PUT', '/api/links/nodes', { nodes }, { cookie: `lp_s=${cookie}` })).status === 403);
		check('another Origin is refused', (await req('PUT', '/api/links/nodes', { nodes }, { cookie: `lp_s=${cookie}`, origin: 'https://evil.example' })).status === 403);
		check('no session is refused', (await req('PUT', '/api/links/nodes', { nodes }, SAME)).status === 401);
		const js = await req('PUT', '/api/links/nodes', { nodes: [{ key: 'x', parent: null, kind: 'link', label: 'x', url: 'javascript:alert(1)' }] }, C);
		check('javascript: links refused', js.status === 400, js.text);
		const loop = await req('PUT', '/api/links/nodes', { nodes: [{ key: 'a', parent: 'b', kind: 'group', label: 'a' }, { key: 'b', parent: 'a', kind: 'group', label: 'b' }] }, C);
		check('a parent must come first (no loops)', loop.status === 400, loop.text);
		const two = await req('PUT', '/api/links/nodes', { nodes: [...nodes, { key: 'd2', parent: null, kind: 'diary', label: 'again' }] }, C);
		check('only one diary', two.status === 400);
		const save = await req('PUT', '/api/links/nodes', { nodes }, C);
		check('saves the tree', save.status === 200 && save.data.ids.l1 > 0, save.text);
		const page = await req('GET', '/~vee');
		check('labels are escaped', page.text.includes('My &lt;script&gt;alert(1)&lt;/script&gt; repo') && !page.text.includes('<script>alert(1)'));
		check('the support note shows, formatted', page.text.includes('<strong>Lots</strong>'));
		check('an empty diary is hidden from visitors', !page.text.includes('AMYBO diary'));
		check('nested groups render', page.text.includes('Deeper'));
		check('groups show no counts', !page.text.includes('class="count"'));
		const go = await req('GET', '/~vee/go/my-script-alert-1-script-repo');
		check('new link slug works', go.status === 302 && go.headers.get('location') === 'https://github.com/vee', `${go.status} ${go.headers.get('location')}`);

		// Delete the link and add one with the same name: it must get a new slug, so old clicks don't transfer.
		const me2 = (await req('GET', '/api/links/me', undefined, { cookie: `lp_s=${cookie}` })).data;
		const old = me2.nodes.find((n) => n.kind === 'link' && n.url === 'https://github.com/vee');
		const keep = me2.nodes.filter((n) => n.id !== old.id).map((n) => ({ id: n.id, key: `k${n.id}`, parent: n.parent_id ? `k${n.parent_id}` : null, kind: n.kind, label: n.label, url: n.url, icon: n.icon, image: n.image, body: n.body }));
		const re = await req('PUT', '/api/links/nodes', { nodes: [...keep, { key: 'new', parent: null, kind: 'link', label: old.label, url: 'https://codeberg.org/vee' }] }, C);
		const me3 = (await req('GET', '/api/links/me', undefined, { cookie: `lp_s=${cookie}` })).data;
		const fresh = me3.nodes.find((n) => n.url === 'https://codeberg.org/vee');
		check('a re-added link gets a new slug', re.status === 200 && fresh && fresh.slug !== old.slug, `${old.slug} → ${fresh?.slug}`);

		// Move a link out of a group and delete the group in the same save: the link must survive.
		const m4 = (await req('GET', '/api/links/me', undefined, { cookie: `lp_s=${cookie}` })).data;
		const deeper = m4.nodes.find((n) => n.label === 'Deeper');
		const mail = m4.nodes.find((n) => n.label === 'Mail me');
		const moved = m4.nodes
			.filter((n) => n.id !== deeper.id)
			.map((n) => ({ id: n.id, key: `k${n.id}`, parent: n.id === mail.id ? null : n.parent_id ? `k${n.parent_id}` : null, kind: n.kind, label: n.label, url: n.url, icon: n.icon, image: n.image, body: n.body }));
		const mv = await req('PUT', '/api/links/nodes', { nodes: moved }, C);
		const m5 = (await req('GET', '/api/links/me', undefined, { cookie: `lp_s=${cookie}` })).data;
		check('moving a link out of a group while deleting the group keeps the link', mv.status === 200 && m5.nodes.some((n) => n.id === mail.id && n.parent_id === null) && !m5.nodes.some((n) => n.id === deeper.id), mv.text);

		// Text items, a group holding one link, colours and sizes, and the page tint.
		const m6 = (await req('GET', '/api/links/me', undefined, { cookie: `lp_s=${cookie}` })).data;
		const base = m6.nodes.map((n) => ({ id: n.id, key: `k${n.id}`, parent: n.parent_id ? `k${n.parent_id}` : null, kind: n.kind, label: n.label, url: n.url, icon: n.icon, image: n.image, body: n.body }));
		const extra = [
			{ key: 'help', parent: null, kind: 'group', label: 'Help me' },
			{ key: 'pat', parent: 'help', kind: 'link', label: 'Patreon', url: 'https://patreon.com/x', icon: 'patreon', tint: 'mono', zoom: 1.3 },
			{ key: 'txt', parent: null, kind: 'text', label: 'About my lab', body: 'We grow **things**.', tint: '#ff0000' },
			{ key: 'lg', parent: null, kind: 'link', label: 'AMYBO', url: 'https://amybo.org/', icon: 'amybo', tint: '#00aa00' },
		];
		check('bad colours are refused', (await req('PUT', '/api/links/nodes', { nodes: [...base, { key: 'bad', parent: null, kind: 'link', label: 'x', url: 'https://x.org', tint: 'red' }] }, C)).status === 400);
		const sv = await req('PUT', '/api/links/nodes', { nodes: [...base, ...extra] }, C);
		check('text items, colours and sizes save', sv.status === 200, sv.text);
		await req('PUT', '/api/links/profile', { name: 'Vee', accent: '#aa3377' }, C);
		const pg = await req('GET', '/~vee');
		check('a group with one link is that link, under the group\'s name', />Help me<\/a>/.test(pg.text) && !/<summary[^>]*>[^<]*<span class="tw"[^>]*>&gt;<\/span>Help me</.test(pg.text));
		check('one twisty open per level (named details)', /<details name="l-\d+">/.test(pg.text) || /<details name="l-root"/.test(pg.text));
		check('text items show their text in the list', pg.text.includes('About my lab') && pg.text.includes('We grow <strong>things</strong>.'));
		check('monochrome and own-colour pictures', pg.text.includes('--brand:var(--ink)') && pg.text.includes('--brand:#ff0000'));
		check('a single-colour logo gets its colour filter', pg.text.includes('<filter id="lt-00aa00"') && pg.text.includes('filter="url(#lt-00aa00)"'));
		check('the page tint is applied', pg.text.includes('data-tint style="--t:#aa3377'));
		check('the tint must be a colour', (await req('PUT', '/api/links/profile', { name: 'Vee', accent: 'pink' }, C)).status === 400);
		const m7 = (await req('GET', '/api/links/me', undefined, { cookie: `lp_s=${cookie}` })).data;
		check('sizes come back to the editor', m7.nodes.some((n) => n.label === 'Patreon' && n.zoom === 1.3 && n.tint === 'mono') && m7.person.accent === '#aa3377');

		// Diary entries are ordinary items inside the diary, with a short date and a highlight.
		const m8 = (await req('GET', '/api/links/me', undefined, { cookie: `lp_s=${cookie}` })).data;
		const keep8 = m8.nodes.map((n) => ({ id: n.id, key: `k${n.id}`, parent: n.parent_id ? `k${n.parent_id}` : null, kind: n.kind, label: n.label, url: n.url, icon: n.icon, image: n.image, body: n.body, tint: n.tint, zoom: n.zoom, day: n.day, highlight: n.highlight }));
		const dk = `k${m8.nodes.find((n) => n.kind === 'diary').id}`;
		const entries = [
			{ key: 'e1', parent: dk, kind: 'text', label: 'Older', body: 'See https://amybo.org/about/', day: '260901' },
			{ key: 'e2', parent: dk, kind: 'text', label: 'Newer', body: 'Built [the rig](https://amybo.org/).', day: '261001' },
			{ key: 'e3', parent: dk, kind: 'link', label: 'Paper', url: 'https://example.org/paper', day: '2609' },
		];
		check('bad dates refused', (await req('PUT', '/api/links/nodes', { nodes: [...keep8, { ...entries[0], day: '2026-09-01' }] }, C)).status === 400);
		const de = await req('PUT', '/api/links/nodes', { nodes: [...keep8, ...entries] }, C);
		check('diary entries save as items', de.status === 200, de.text);
		let pgd = await req('GET', '/~vee');
		const order = ['Newer 261001', 'Older 260901', 'Paper 2609'].map((t) => pgd.text.indexOf(t));
		check('diary entries show newest first, with short dates in their titles', order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), order.join(','));
		check('no highlights: no All group', !/>All<\/summary>/.test(pgd.text));
		const d = await req('GET', '/~vee/diary');
		check('the diary page lists them, newest first', d.status === 200 && d.text.indexOf('Newer') < d.text.indexOf('Older') && d.text.includes('1 October 2026'), d.status);
		check('diary links are safe', d.text.includes('href="https://amybo.org/" rel="nofollow ugc noopener"'));
		await req('PUT', '/api/links/nodes', { nodes: [...keep8, { ...entries[0] }, { ...entries[1], highlight: true }, entries[2]] }, C);
		pgd = await req('GET', '/~vee');
		check('with a highlight: highlights first, then an All group with everything', /Newer 261001[^]*>All<\/summary>[^]*Newer 261001[^]*Older 260901/.test(pgd.text));
		const hl = await req('GET', '/~vee/diary?view=highlights');
		check('the diary page can show highlights only', hl.text.includes('Newer') && !hl.text.includes('Older'));
		const hubp = await req('PUT', '/api/links/profile', { name: 'Vee Volunteer', bio: 'Builds things', hub_icon: 'flask', hub_tint: '#123456', hub_zoom: 1.4 }, C);
		check('the centre can have its own picture, colour and size', hubp.status === 200 && /<g class="hubg"[^]*?--brand:#123456[^]*?<\/g>/.test((await req('GET', '/~vee')).text), hubp.text);
		check('unknown centre pictures are refused', (await req('PUT', '/api/links/profile', { name: 'Vee', hub_icon: 'nope' }, C)).status === 400);
		await req('PUT', '/api/links/profile', { name: 'Vee Volunteer', bio: 'Builds things' }, C);
		check('the page now shows the diary', (await req('GET', '/~vee')).text.includes('AMYBO diary'));
		const pf = await req('PUT', '/api/links/profile', { name: 'Vee', photo: 'r2:martin/abc.webp' }, C);
		check("someone else's image is refused", pf.status === 400);
		check('a name is required', (await req('PUT', '/api/links/profile', { name: ' ' }, C)).status === 400);
		await req('PUT', '/api/links/profile', { name: 'Vee', basic_mode: true }, C);
		check('basic mode drops the map', !(await req('GET', '/~vee')).text.includes('class="mapsvg"'));
		const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const upload = async () => {
			const r = await fetch(`${BASE}/api/links/upload`, { method: 'POST', headers: { ...C, 'user-agent': UA, 'content-type': 'image/png' }, body: png });
			return { status: r.status, data: await r.json() };
		};
		const up = await upload();
		check('uploads go to the bucket under their own folder', up.status === 200 && /^r2:vee\/[A-Za-z0-9_-]+\.png$/.test(up.data.value), JSON.stringify(up.data));
		const media = await fetch(`${BASE}${up.data.url}`);
		check('and are served with a long cache', media.status === 200 && /immutable/.test(media.headers.get('cache-control') || ''), media.status);
		check('uploads refuse other types', (await fetch(`${BASE}/api/links/upload`, { method: 'POST', headers: { ...C, 'content-type': 'text/html' }, body: '<p>' })).status === 415);
		await req('PUT', '/api/links/profile', { name: 'Vee', photo: up.data.value }, C);
		check('a page can use its upload as its photo', (await req('GET', '/~vee')).text.includes(up.data.url));
		await req('PUT', '/api/links/profile', { name: 'Vee', photo: '' }, C);
		await sleep(400);
		check('replacing it deletes the old image', (await fetch(`${BASE}${up.data.url}`)).status === 404);
		const orphan = await upload();
		const sw = await req('POST', '/api/admin/links/sweep', { minAgeHours: 0 }, ADMIN);
		check('the admin sweep removes uploads nothing uses', sw.status === 200 && sw.data.removed >= 1 && (await fetch(`${BASE}${orphan.data.url}`)).status === 404, sw.text);
		check('the sweep needs Access', (await req('POST', '/api/admin/links/sweep', {}, { origin: BASE })).status === 401);
		const pr = await req('GET', `/api/links/propose?url=${encodeURIComponent('http://127.0.0.1:8789/')}`, undefined, { cookie: `lp_s=${cookie}` });
		check('suggestions refuse private addresses', pr.status === 400, pr.status);
		const pm = await req('GET', `/api/links/propose?url=${encodeURIComponent('mailto:vee@example.org')}`, undefined, { cookie: `lp_s=${cookie}` });
		check('suggestions handle email links', pm.data.icon === 'mail');
		const ri = await req('GET', `/api/links/remote-image?url=${encodeURIComponent('https://example.org/x.png')}`, undefined, { cookie: `lp_s=${cookie}`, 'sec-fetch-site': 'cross-site' });
		check('remote images only for the editor itself', ri.status === 403, ri.status);
		const foreign = await req('PUT', '/api/links/nodes', { nodes: [{ key: 'i', parent: null, kind: 'link', label: 'x', url: 'https://x.org', image: 'r2:vee/../martin/a.webp' }] }, C);
		check("image paths can't climb out of their own folder", foreign.status === 400, foreign.text);
	}

	console.log('\nAccessibility (axe, serious and critical)');
	for (const path of ['/~martin', '/links', '/~vee', '/~vee/diary', '/~vee/diary?view=all']) {
		const r = await req('GET', path);
		const v = await axe(r.text, BASE + path);
		check(`${path} has no serious accessibility problems`, v.length === 0, v.join('; '));
	}

	console.log('\nDisabling');
	{
		const me = (await req('GET', '/api/links/me', undefined, { cookie: `lp_s=${cookie}` })).data;
		const people = await req('GET', '/admin/links/', undefined, ADMIN);
		const id = /data-act="disable" data-id="(\d+)"[^]*?<\/tr>/g;
		const vid = [...people.text.matchAll(/<tr><td><a href="\/~vee">[^]*?data-act="disable" data-id="(\d+)"/g)][0]?.[1];
		check('admin lists the page', !!vid && !!me, vid);
		await sleep(61000 - (Date.now() - lastSignin));
		await req('POST', '/api/links/signin', { email: 'vee@example.org' }, SAME);
		await sleep(500);
		const pendingToken = (await lastTokenFor('vee@example.org')).token;
		const ce = await req('POST', '/api/admin/links/person', { id: Number(vid), action: 'email', email: 'Vee.New@example.org' }, ADMIN);
		check('admin can change a sign-in email', ce.status === 200, ce.text);
		check('changing it ends their sessions', (await req('GET', '/api/links/me', undefined, { cookie: `lp_s=${cookie}` })).status === 401);
		check('and cancels links sent to the old address', (await req('POST', '/api/links/verify', { token: pendingToken, peek: true }, SAME)).status === 400);
		const ce2 = await req('POST', '/api/admin/links/person', { id: Number(vid), action: 'email', email: 'hello@amybo.org' }, ADMIN);
		check("but not to another page's address", ce2.status === 400, ce2.text);
		const r = await req('POST', '/api/admin/links/person', { id: Number(vid), action: 'disable' }, ADMIN);
		check('disable works', r.status === 200, r.text);
		check('a disabled page is gone', (await req('GET', '/~vee')).status === 404);
		await req('POST', '/api/links/signin', { email: 'vee.new@example.org' }, SAME);
		check('a disabled page gets no sign-in links', !(await outbox()).some((e) => e.to_addr === 'vee.new@example.org'));
		void id;
	}
} catch (e) {
	failures++;
	console.error(e);
} finally {
	try {
		process.kill(-server.pid);
	} catch {}
	if (devVarsBackup !== null) writeFileSync('.dev.vars', devVarsBackup);
	else rmSync('.dev.vars', { force: true });
	console.log(`\n${passes} passed, ${failures} failed`);
	if (failures) console.log(serverLog.split('\n').filter((l) => /error|Error|✘/.test(l)).slice(-20).join('\n'));
	process.exit(failures ? 1 : 0);
}
