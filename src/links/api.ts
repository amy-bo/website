// Link pages: the editor's API (/api/links/*) and the admin API (/api/admin/links/*).
import { orgName } from '../../eventsandeye/src/env';
import { checkOrigin, endSession, fail, json, nowIso, personFromSession, redeem, sendLink, startSession, type SessionPerson } from './auth';
import { guessIcon, ICON_KEYS } from './icons';
import { HANDLE_RE, type NodeKind } from './model';
import type { Ctx, Env } from './server';

const RESERVED = new Set(['amybo', 'links', 'admin', 'api', 'edit', 'www', 'go', 'media', 'diary', 'events', 'help', 'about']);
const KINDS: NodeKind[] = ['group', 'link', 'diary', 'support'];
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;

const body = async <T>(req: Request): Promise<T | null> => {
	try {
		return (await req.json()) as T;
	} catch {
		return null;
	}
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function signedIn(ctx: Ctx): Promise<SessionPerson | Response> {
	const bad = checkOrigin(ctx);
	if (bad) return bad;
	const p = await personFromSession(ctx.env, ctx.request);
	return p ?? fail('Please sign in again', 401);
}

// ---- sign-in ----

export async function signin(ctx: Ctx): Promise<Response> {
	const bad = checkOrigin(ctx);
	if (bad) return bad;
	const b = await body<{ email?: string }>(ctx.request);
	const email = str(b?.email, 254).toLowerCase();
	if (!EMAIL_RE.test(email)) return fail('Please enter your email address');
	const p = await ctx.env.DB.prepare(`SELECT id, email, name, handle FROM lp_people WHERE email = ? AND status != 'disabled'`).bind(email).first<{ id: number; email: string; name: string; handle: string }>();
	if (p) {
		// At most one link a minute and five an hour per person, so nobody can be flooded with emails.
		const r = await ctx.env.DB.prepare(
			`SELECT COUNT(*) AS hour, SUM(created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-60 seconds')) AS minute
			 FROM lp_tokens WHERE person_id = ? AND purpose = 'signin' AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour')`,
		)
			.bind(p.id)
			.first<{ hour: number; minute: number }>();
		if ((r?.hour ?? 0) < 5 && !(r?.minute ?? 0)) await sendLink(ctx.env, p, 'signin');
	}
	// The same answer whether or not the address has a page, so the form can't be used to find out who does.
	return json({ ok: true });
}

export async function verify(ctx: Ctx): Promise<Response> {
	const bad = checkOrigin(ctx);
	if (bad) return bad;
	const b = await body<{ token?: string }>(ctx.request);
	const id = await redeem(ctx.env, str(b?.token, 100));
	if (!id) return fail('This link has expired or been used. Ask for a new one below.', 400);
	const cookie = await startSession(ctx.env, ctx.request, id);
	return json({ ok: true }, 200, { 'set-cookie': cookie });
}

export async function signout(ctx: Ctx): Promise<Response> {
	const bad = checkOrigin(ctx);
	if (bad) return bad;
	return json({ ok: true }, 200, { 'set-cookie': await endSession(ctx.env, ctx.request) });
}

// ---- reading and saving a page ----

export async function me(ctx: Ctx): Promise<Response> {
	const p = await personFromSession(ctx.env, ctx.request);
	if (!p) return fail('Not signed in', 401);
	const db = ctx.env.DB;
	const [person, nodes, diary, counts] = await db.batch([
		db.prepare('SELECT handle, email, name, bio, photo, kind, basic_mode, diary_default FROM lp_people WHERE id = ?').bind(p.id),
		db.prepare('SELECT id, parent_id, kind, slug, label, url, icon, image, body, seed, position FROM lp_nodes WHERE person_id = ? ORDER BY position, id').bind(p.id),
		db.prepare('SELECT id, day, title, body, highlight FROM lp_diary WHERE person_id = ? ORDER BY day DESC, id DESC').bind(p.id),
		db.prepare(
			`SELECT slug, COUNT(*) AS total, SUM(at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')) AS d30 FROM link_events WHERE page = ? GROUP BY slug`,
		).bind(p.handle),
	]);
	return json({ person: person.results[0], nodes: nodes.results, diary: diary.results, stats: counts.results, uploads: !!ctx.env.LINKS_BUCKET, icons: ICON_KEYS });
}

const okImage = (v: string, handle: string) => v === '' || v.startsWith(`r2:${handle}/`) || /^\/link-media\/[\w.-]+$/.test(v);

export async function saveProfile(ctx: Ctx): Promise<Response> {
	const p = await signedIn(ctx);
	if (p instanceof Response) return p;
	const b = await body<Record<string, unknown>>(ctx.request);
	if (!b) return fail('Nothing to save');
	const name = str(b.name, 80);
	if (!name) return fail('Your page needs a name');
	const photo = str(b.photo, 300);
	if (!okImage(photo, p.handle)) return fail('That photo is not one of your uploads');
	const diaryDefault = b.diary_default === 'highlights' ? 'highlights' : 'all';
	await ctx.env.DB.prepare('UPDATE lp_people SET name = ?, bio = ?, photo = ?, basic_mode = ?, diary_default = ?, updated_at = ? WHERE id = ?')
		.bind(name, str(b.bio, 300), photo, b.basic_mode ? 1 : 0, diaryDefault, nowIso(), p.id)
		.run();
	return json({ ok: true });
}

interface InNode {
	id?: number;
	key: string;
	parent: string | null;
	kind: NodeKind;
	label: string;
	url?: string;
	icon?: string;
	image?: string;
	body?: string;
}

const slugify = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40) || 'link';

/** Replaces the person's whole tree with the editor's, keeping ids (and so slugs and click history) where it can. */
export async function saveNodes(ctx: Ctx): Promise<Response> {
	const p = await signedIn(ctx);
	if (p instanceof Response) return p;
	const b = await body<{ nodes?: InNode[] }>(ctx.request);
	const list = Array.isArray(b?.nodes) ? b!.nodes : null;
	if (!list) return fail('Nothing to save');
	if (list.length > 250) return fail('That is more than 250 items; please split some into another page');
	const db = ctx.env.DB;
	const existing = (await db.prepare('SELECT id, slug FROM lp_nodes WHERE person_id = ?').bind(p.id).all<{ id: number; slug: string }>()).results;
	const existingById = new Map(existing.map((r) => [r.id, r]));
	const usedSlugs = new Set(
		(await db.prepare('SELECT DISTINCT slug FROM link_events WHERE page = ?').bind(p.handle).all<{ slug: string }>()).results.map((r) => r.slug),
	);
	existing.forEach((r) => usedSlugs.add(r.slug));

	// Validate.
	const keys = new Map<string, InNode>();
	let diaries = 0;
	let supports = 0;
	for (const n of list) {
		if (!n || typeof n.key !== 'string' || !n.key || keys.has(n.key)) return fail('The page data is muddled; please reload the editor');
		if (!KINDS.includes(n.kind)) return fail('Unknown item type');
		const label = str(n.label, 120);
		if (!label) return fail('Every item needs a name');
		if (n.kind === 'link') {
			const url = str(n.url, 2000);
			if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(url)) return fail(`"${label}" needs a web address starting https:// (or mailto:)`);
		}
		if (n.kind === 'diary' && ++diaries > 1) return fail('A page can have one diary');
		if (n.kind === 'support' && ++supports > 1) return fail('A page can have one support note');
		if (n.id != null && !existingById.has(n.id)) return fail('The page data is out of date; please reload the editor');
		if (n.icon && !ICON_KEYS.includes(n.icon)) n.icon = '';
		if (!okImage(str(n.image, 300), p.handle)) return fail(`The image for "${label}" is not one of your uploads`);
		keys.set(n.key, n);
	}
	// Parents may be listed in any order, but must be groups, and the tree must have no loops.
	for (const n of list) {
		if (n.parent === null) continue;
		const parent = keys.get(n.parent);
		if (!parent || parent.kind !== 'group') return fail('Items can only sit inside groups');
	}
	const depth = (n: InNode, seen = new Set<string>()): number => {
		if (seen.has(n.key)) return Infinity;
		seen.add(n.key);
		return n.parent ? 1 + depth(keys.get(n.parent)!, seen) : 0;
	};
	for (const n of list) {
		const d = depth(n);
		if (d === Infinity) return fail('The page data is muddled; please reload the editor');
		if (d > 4) return fail('Groups can go five levels deep at most');
	}

	// New items get a slug that has never been used on this page, so old clicks never land on a new link.
	const slugFor = (n: InNode) => {
		const base = n.kind === 'group' ? `group-${slugify(n.label)}` : n.kind === 'link' ? slugify(n.label) : n.kind;
		let s = base;
		for (let i = 2; usedSlugs.has(s); i++) s = `${base}-${i}`;
		usedSlugs.add(s);
		return s;
	};

	const keep = new Set(list.filter((n) => n.id != null).map((n) => n.id!));
	const stmts: D1PreparedStatement[] = [];
	for (const r of existing) if (!keep.has(r.id)) stmts.push(db.prepare('DELETE FROM lp_nodes WHERE id = ? AND person_id = ?').bind(r.id, p.id));
	const fresh = list.filter((n) => n.id == null);
	const inserts = fresh.map((n) =>
		db.prepare(`INSERT INTO lp_nodes (person_id, kind, slug, label) VALUES (?, ?, ?, ?) RETURNING id`).bind(p.id, n.kind, slugFor(n), str(n.label, 120)),
	);
	const results = await db.batch([...stmts, ...inserts]);
	const idOf = new Map<string, number>();
	list.forEach((n) => n.id != null && idOf.set(n.key, n.id));
	fresh.forEach((n, i) => idOf.set(n.key, (results[stmts.length + i].results[0] as { id: number }).id));

	const position = new Map<string | null, number>();
	const updates = list.map((n) => {
		const pos = position.get(n.parent) ?? 0;
		position.set(n.parent, pos + 1);
		return db
			.prepare('UPDATE lp_nodes SET parent_id = ?, kind = ?, label = ?, url = ?, icon = ?, image = ?, body = ?, position = ? WHERE id = ? AND person_id = ?')
			.bind(
				n.parent ? idOf.get(n.parent)! : null,
				n.kind,
				str(n.label, 120),
				n.kind === 'link' ? str(n.url, 2000) : '',
				n.icon ?? '',
				str(n.image, 300),
				n.kind === 'support' ? str(n.body, 5000) : '',
				pos,
				idOf.get(n.key)!,
				p.id,
			);
	});
	if (updates.length) await db.batch(updates);
	await db.prepare('UPDATE lp_people SET updated_at = ? WHERE id = ?').bind(nowIso(), p.id).run();
	return json({ ok: true, ids: Object.fromEntries(idOf) });
}

export async function saveDiary(ctx: Ctx): Promise<Response> {
	const p = await signedIn(ctx);
	if (p instanceof Response) return p;
	const db = ctx.env.DB;
	if (ctx.request.method === 'DELETE') {
		const id = Number(new URL(ctx.request.url).searchParams.get('id'));
		await db.prepare('DELETE FROM lp_diary WHERE id = ? AND person_id = ?').bind(id, p.id).run();
		return json({ ok: true });
	}
	const b = await body<{ id?: number; day?: string; title?: string; body?: string; highlight?: boolean }>(ctx.request);
	const day = str(b?.day, 10);
	const title = str(b?.title, 160);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) return fail('Please give the entry a date');
	if (!title) return fail('Please give the entry a title');
	const text = typeof b?.body === 'string' ? b.body.slice(0, 20000) : '';
	if (b?.id) {
		await db.prepare('UPDATE lp_diary SET day = ?, title = ?, body = ?, highlight = ?, updated_at = ? WHERE id = ? AND person_id = ?')
			.bind(day, title, text, b.highlight ? 1 : 0, nowIso(), b.id, p.id)
			.run();
		return json({ ok: true, id: b.id });
	}
	const n = await db.prepare('SELECT COUNT(*) AS n FROM lp_diary WHERE person_id = ?').bind(p.id).first<{ n: number }>();
	if ((n?.n ?? 0) >= 2000) return fail('The diary is full (2,000 entries)');
	const row = await db.prepare('INSERT INTO lp_diary (person_id, day, title, body, highlight) VALUES (?, ?, ?, ?, ?) RETURNING id').bind(p.id, day, title, text, b?.highlight ? 1 : 0).first<{ id: number }>();
	return json({ ok: true, id: row?.id });
}

// ---- images ----

export async function upload(ctx: Ctx): Promise<Response> {
	const bad = checkOrigin(ctx, { allowImage: true });
	if (bad) return bad;
	const p = await personFromSession(ctx.env, ctx.request);
	if (!p) return fail('Please sign in again', 401);
	if (!ctx.env.LINKS_BUCKET) return fail("Image uploads aren't switched on yet; pick an icon for now", 503);
	const type = (ctx.request.headers.get('content-type') ?? '').split(';')[0].trim();
	const bytes = await ctx.request.arrayBuffer();
	if (bytes.byteLength > 1_500_000) return fail('That image is too large (1.5 MB at most)', 413);
	const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }[type];
	if (!ext) return fail('Use a JPEG, PNG, WebP or GIF image', 415);
	const id = crypto.getRandomValues(new Uint8Array(12));
	const key = `${p.handle}/${btoa(String.fromCharCode(...id)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${ext}`;
	await ctx.env.LINKS_BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
	return json({ ok: true, value: `r2:${key}`, url: `/links/media/${key}` });
}

/** Only public web addresses: no IP literals, local names or odd ports, so the server can't be used to probe networks. */
function publicUrl(raw: string | null): URL | null {
	if (!raw) return null;
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return null;
	}
	if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) return null;
	const h = u.hostname.toLowerCase();
	if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(h)) return null;
	return u;
}

async function fetchLimited(url: URL, accept: string, limit: number): Promise<{ res: Response; bytes: Uint8Array; final: string } | null> {
	let current = url;
	for (let hop = 0; hop < 5; hop++) {
		const res = await fetch(current.toString(), {
			headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; AMYBO link preview; +https://amybo.org/)' },
			redirect: 'manual',
			signal: AbortSignal.timeout(6000),
		});
		if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
			const next = publicUrl(new URL(res.headers.get('location')!, current).toString());
			if (!next) return null;
			current = next;
			continue;
		}
		if (!res.ok || !res.body) return null;
		const reader = res.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				reader.cancel();
				if (accept.startsWith('image')) return null;
				break;
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(Math.min(size, limit));
		let o = 0;
		for (const c of chunks) {
			bytes.set(c.subarray(0, Math.min(c.byteLength, bytes.length - o)), o);
			o += c.byteLength;
			if (o >= bytes.length) break;
		}
		return { res, bytes, final: current.toString() };
	}
	return null;
}

const decodeEntities = (s: string) =>
	s
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();

/** GET /api/links/propose?url=: a suggested name, icon and image for a new link. */
export async function propose(ctx: Ctx): Promise<Response> {
	const p = await personFromSession(ctx.env, ctx.request);
	if (!p) return fail('Not signed in', 401);
	const raw = new URL(ctx.request.url).searchParams.get('url') ?? '';
	if (/^mailto:/i.test(raw)) return json({ url: raw, title: 'Email', icon: 'mail', image: '' });
	const u = publicUrl(raw);
	if (!u) return fail('That does not look like a public web address');
	const fallback = { url: u.toString(), title: u.hostname.replace(/^www\./, ''), icon: guessIcon(u.toString()), image: '' };
	let got: Awaited<ReturnType<typeof fetchLimited>> = null;
	try {
		got = await fetchLimited(u, 'text/html,application/xhtml+xml', 400_000);
	} catch {
		got = null;
	}
	if (!got || !/html/i.test(got.res.headers.get('content-type') ?? '')) return json(fallback);
	const html = new TextDecoder().decode(got.bytes);
	const meta = (prop: string) =>
		new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)?.[1] ??
		new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i').exec(html)?.[1];
	const title = decodeEntities(meta('og:title') ?? /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1] ?? '').slice(0, 120);
	const site = decodeEntities(meta('og:site_name') ?? '');
	const abs = (v?: string | null) => {
		if (!v) return '';
		try {
			const x = new URL(decodeEntities(v), got!.final);
			return /^https?:$/.test(x.protocol) ? x.toString() : '';
		} catch {
			return '';
		}
	};
	const touch = /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
	const iconHref = /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
	return json({
		url: got.final,
		title: title || site || fallback.title,
		site,
		icon: guessIcon(got.final),
		image: abs(meta('og:image')),
		favicon: abs(touch) || abs(iconHref) || new URL('/favicon.ico', got.final).toString(),
	});
}

/** GET /api/links/remote-image?url=: fetches a suggested image so the editor can resize it and upload it here. */
export async function remoteImage(ctx: Ctx): Promise<Response> {
	const p = await personFromSession(ctx.env, ctx.request);
	if (!p) return fail('Not signed in', 401);
	const u = publicUrl(new URL(ctx.request.url).searchParams.get('url'));
	if (!u) return fail('Not a public image address');
	try {
		const got = await fetchLimited(u, 'image/*', 4_000_000);
		const type = got?.res.headers.get('content-type') ?? '';
		if (!got || !/^image\/(png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon|svg\+xml)/.test(type)) return fail('Could not fetch that image', 404);
		return new Response(got.bytes, { headers: { 'content-type': type, 'cache-control': 'private, max-age=600', 'content-security-policy': "default-src 'none'" } });
	} catch {
		return fail('Could not fetch that image', 404);
	}
}

// ---- admin (behind Cloudflare Access: functions/api/admin/_middleware.ts) ----

export async function adminInvite(ctx: Ctx): Promise<Response> {
	const b = await body<Record<string, string>>(ctx.request);
	const email = str(b?.email, 254).toLowerCase();
	const name = str(b?.name, 80);
	const handle = str(b?.handle, 30).toLowerCase();
	const role = ['volunteer', 'supporter', 'both', 'plain'].includes(b?.role ?? '') ? b!.role : 'volunteer';
	if (!EMAIL_RE.test(email)) return fail('Check the email address');
	if (!name) return fail('Add their name');
	if (!HANDLE_RE.test(handle) || RESERVED.has(handle)) return fail('That address is not available: use lower-case letters, numbers and hyphens');
	const db = ctx.env.DB;
	const clash = await db.prepare('SELECT handle, email FROM lp_people WHERE handle = ? OR email = ?').bind(handle, email).first<{ handle: string; email: string }>();
	if (clash) return fail(clash.handle === handle ? `amy.bo/~${handle} is taken` : `${email} already has a page (amy.bo/~${clash.handle})`);
	const person = await db.prepare(`INSERT INTO lp_people (handle, email, name, status) VALUES (?, ?, ?, 'invited') RETURNING id`).bind(handle, email, name).first<{ id: number }>();
	const id = person!.id;
	const starter: D1PreparedStatement[] = [];
	if (role === 'volunteer' || role === 'both')
		starter.push(db.prepare(`INSERT INTO lp_nodes (person_id, kind, slug, label, icon, position) VALUES (?, 'diary', 'diary', 'AMYBO diary', 'diary', 0)`).bind(id));
	if (role === 'supporter' || role === 'both')
		starter.push(db.prepare(`INSERT INTO lp_nodes (person_id, kind, slug, label, icon, position) VALUES (?, 'support', 'support', 'How I support AMYBO', 'heart', 1)`).bind(id));
	if (starter.length) await db.batch(starter);
	await sendLink(ctx.env, { id, email, name, handle }, 'invite', orgName(ctx.env));
	return json({ ok: true });
}

export async function adminPerson(ctx: Ctx): Promise<Response> {
	const b = await body<{ id?: number; action?: string; email?: string }>(ctx.request);
	const db = ctx.env.DB;
	const p = await db.prepare('SELECT id, email, name, handle, status, last_sign_in FROM lp_people WHERE id = ?').bind(Number(b?.id)).first<{ id: number; email: string; name: string; handle: string; status: string; last_sign_in: string | null }>();
	if (!p) return fail('No such page', 404);
	if (b?.action === 'disable') {
		await db.batch([db.prepare(`UPDATE lp_people SET status = 'disabled' WHERE id = ?`).bind(p.id), db.prepare('DELETE FROM lp_sessions WHERE person_id = ?').bind(p.id)]);
	} else if (b?.action === 'enable') {
		await db.prepare('UPDATE lp_people SET status = ? WHERE id = ?').bind(p.last_sign_in ? 'active' : 'invited', p.id).run();
	} else if (b?.action === 'email') {
		const email = str((b as { email?: string }).email, 254).toLowerCase();
		if (!EMAIL_RE.test(email)) return fail('Check the email address');
		const clash = await db.prepare('SELECT handle FROM lp_people WHERE email = ? AND id != ?').bind(email, p.id).first<{ handle: string }>();
		if (clash) return fail(`${email} already has a page (amy.bo/~${clash.handle})`);
		await db.batch([db.prepare('UPDATE lp_people SET email = ? WHERE id = ?').bind(email, p.id), db.prepare('DELETE FROM lp_sessions WHERE person_id = ?').bind(p.id)]);
	} else if (b?.action === 'resend' && p.status === 'invited') {
		await sendLink(ctx.env, p, 'invite', orgName(ctx.env));
	} else return fail('Unknown action');
	return json({ ok: true });
}

export type { Env };
