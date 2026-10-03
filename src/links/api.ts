// Link pages: the editor's API (/api/links/*) and the admin API (/api/admin/links/*).
import { orgName } from '../../eventsandeye/src/env';
import { checkOrigin, endSession, fail, json, nowIso, peek, personFromSession, redeem, sendLink, startSession, type SessionPerson } from './auth';
import { guessIcon, ICON_KEYS } from './icons';
import { HANDLE_RE, NODE_SELECT, PERSON_SELECT, type NodeKind } from './model';
import type { Ctx, Env } from './server';

const RESERVED = new Set(['amybo', 'links', 'admin', 'api', 'edit', 'www', 'go', 'media', 'diary', 'events', 'help', 'about']);
const KINDS: NodeKind[] = ['group', 'link', 'text', 'diary', 'support'];
const TINT_RE = /^(|mono|#[0-9a-f]{6})$/i;
const cleanZoom = (z: unknown) => Math.min(2.4, Math.max(0.6, Number(z) || 1));
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;

const body = async <T>(req: Request): Promise<T | null> => {
	try {
		return (await req.json()) as T;
	} catch {
		return null;
	}
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---- uploaded images: delete the ones nothing uses any more ----

const r2Key = (v: string | null | undefined) => (v && v.startsWith('r2:') ? v.slice(3) : null);

/** Every uploaded image a person's page still uses (photo and items). */
async function imagesInUse(db: D1Database, personId: number): Promise<Set<string>> {
	const [person, nodes] = await db.batch([
		db.prepare('SELECT photo FROM lp_people WHERE id = ?').bind(personId),
		db.prepare(`SELECT image FROM lp_nodes WHERE person_id = ? AND image LIKE 'r2:%'`).bind(personId),
	]);
	const keys = [...(person.results as { photo: string }[]).map((r) => r.photo), ...(nodes.results as { image: string }[]).map((r) => r.image)].map(r2Key);
	return new Set(keys.filter((k): k is string => !!k));
}

/** After a save: removes from the bucket the images that were in use before and aren't now. Best effort. */
function forgetImages(ctx: Ctx, before: Set<string>, after: Set<string>) {
	const gone = [...before].filter((k) => !after.has(k));
	if (gone.length && ctx.env.LINKS_BUCKET) ctx.waitUntil(ctx.env.LINKS_BUCKET.delete(gone).catch((e) => console.error('image tidy failed', e)));
}

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
	// The email goes out after the response, so the answer takes as long whether or not the address has a page.
	// sendLink itself allows at most one link a minute and five an hour per person.
	if (p) ctx.waitUntil(sendLink(ctx.env, p, 'signin').catch((e) => console.error('sign-in email failed', e)));
	// The same answer whether or not the address has a page, so the form can't be used to find out who does.
	return json({ ok: true });
}

export async function verify(ctx: Ctx): Promise<Response> {
	const bad = checkOrigin(ctx);
	if (bad) return bad;
	const b = await body<{ token?: string; peek?: boolean }>(ctx.request);
	if (b?.peek) {
		// Say whose page a link is for before using it, so nobody can be signed into someone else's page unawares.
		const who = await peek(ctx.env, str(b.token, 100));
		return who ? json({ handle: who.handle, name: who.name }) : fail('This link has expired or been used. Ask for a new one below.', 400);
	}
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
	const [person, nodes, counts] = await db.batch([
		db.prepare(`${PERSON_SELECT} WHERE p.id = ?`).bind(p.id),
		db.prepare(`${NODE_SELECT} ORDER BY n.position, n.id`).bind(p.id),
		db.prepare(
			`SELECT slug, COUNT(*) AS total, SUM(at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')) AS d30 FROM link_events WHERE page = ? GROUP BY slug`,
		).bind(p.handle),
	]);
	return json({ person: person.results[0], nodes: nodes.results, stats: counts.results, uploads: !!ctx.env.LINKS_BUCKET, icons: ICON_KEYS });
}

const okImage = (v: string, handle: string) =>
	v === '' || (v.startsWith(`r2:${handle}/`) && /^r2:[a-z0-9-]+\/[A-Za-z0-9_-]+\.(webp|png|jpe?g|gif)$/.test(v)) || /^\/link-media\/[\w-]+\.(jpe?g|png|webp|svg)$/.test(v);

export async function saveProfile(ctx: Ctx): Promise<Response> {
	const p = await signedIn(ctx);
	if (p instanceof Response) return p;
	const b = await body<Record<string, unknown>>(ctx.request);
	if (!b) return fail('Nothing to save');
	const name = str(b.name, 80);
	if (!name) return fail('Your page needs a name');
	const photo = str(b.photo, 300);
	if (!okImage(photo, p.handle)) return fail('That photo is not one of your uploads');
	const diaryDefault = 'all';
	const accent = str(b.accent, 7);
	if (!/^(|#[0-9a-f]{6})$/i.test(accent)) return fail('The tint must be a colour like #3f9c00');
	const hubIcon = str(b.hub_icon, 40);
	const hubTint = str(b.hub_tint, 7);
	if (hubIcon && !ICON_KEYS.includes(hubIcon)) return fail('Unknown picture for the centre');
	if (!TINT_RE.test(hubTint)) return fail('The centre colour must be like #3f9c00');
	const hubDkIcon = str(b.hub_dk_icon, 40);
	const hubDkTint = str(b.hub_dk_tint, 7);
	if (hubDkIcon && !ICON_KEYS.includes(hubDkIcon)) return fail('Unknown dark-mode picture for the centre');
	if (!TINT_RE.test(hubDkTint)) return fail('The centre dark-mode colour must be like #3f9c00');
	const before = await imagesInUse(ctx.env.DB, p.id);
	await ctx.env.DB.batch([
		ctx.env.DB.prepare('UPDATE lp_people SET name = ?, bio = ?, photo = ?, basic_mode = ?, diary_default = ?, updated_at = ? WHERE id = ?').bind(
			name,
			str(b.bio, 300),
			photo,
			b.basic_mode ? 1 : 0,
			diaryDefault,
			nowIso(),
			p.id,
		),
		ctx.env.DB.prepare(
			`INSERT INTO lp_page_meta (person_id, accent, hub_icon, hub_tint, hub_zoom) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(person_id) DO UPDATE SET accent = excluded.accent, hub_icon = excluded.hub_icon, hub_tint = excluded.hub_tint, hub_zoom = excluded.hub_zoom`,
		).bind(p.id, accent.toLowerCase(), hubIcon, hubTint.toLowerCase(), cleanZoom(b.hub_zoom)),
		ctx.env.DB.prepare(
			`INSERT INTO lp_page_dark (person_id, linked, icon, tint, zoom) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(person_id) DO UPDATE SET linked = excluded.linked, icon = excluded.icon, tint = excluded.tint, zoom = excluded.zoom`,
		).bind(p.id, b.hub_dk_linked === false || b.hub_dk_linked === 0 ? 0 : 1, hubDkIcon, hubDkTint.toLowerCase(), cleanZoom(b.hub_dk_zoom)),
	]);
	forgetImages(ctx, before, await imagesInUse(ctx.env.DB, p.id));
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
	tint?: string;
	zoom?: number;
	day?: string;
	highlight?: boolean | number;
	dk_linked?: boolean | number;
	dk_icon?: string;
	dk_tint?: string;
	dk_zoom?: number;
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
		if (!TINT_RE.test(String(n.tint ?? ''))) return fail(`The colour for "${label}" must be like #3f9c00`);
		if (n.dk_icon && !ICON_KEYS.includes(n.dk_icon)) n.dk_icon = '';
		if (!TINT_RE.test(String(n.dk_tint ?? ''))) return fail(`The dark-mode colour for "${label}" must be like #3f9c00`);
		if (!/^(|\d{2}|\d{4}|\d{6})$/.test(String(n.day ?? ''))) return fail(`The date for "${label}" must be YY, YYMM or YYMMDD, like 2608 or 260822`);
		if (!okImage(str(n.image, 300), p.handle)) return fail(`The image for "${label}" is not one of your uploads`);
		keys.set(n.key, n);
	}
	// Parents may be listed in any order, but must be groups, and the tree must have no loops.
	for (const n of list) {
		if (n.parent === null) continue;
		const parent = keys.get(n.parent);
		if (!parent || (parent.kind !== 'group' && parent.kind !== 'diary')) return fail('Items can only sit inside groups and diaries');
	}
	const depth = (n: InNode, seen = new Set<string>()): number => {
		if (seen.has(n.key)) return Infinity;
		seen.add(n.key);
		return n.parent ? 1 + depth(keys.get(n.parent)!, seen) : 0;
	};
	for (const n of list) {
		const d = depth(n);
		if (d === Infinity) return fail('The page data is muddled; please reload the editor');
		if (d > 30) return fail('Items can go thirty levels deep at most');
	}

	// Every item's address (its slug, as in amy.bo/~name#socials) comes from its name, and is never one used before on
	// this page, so old clicks never land on a new link. Once set it stays, so aliases to it keep working.
	const slugFor = (n: InNode) => {
		const base = slugify(n.label) || n.kind;
		let s = base;
		for (let i = 2; usedSlugs.has(s); i++) s = `${base}-${i}`;
		usedSlugs.add(s);
		return s;
	};

	const keep = new Set(list.filter((n) => n.id != null).map((n) => n.id!));
	// New items first (to learn their ids), then in ONE transaction: every update (so kept items have left any group
	// that is about to go) and only then the deletes. If that fails, the new rows are removed again.
	const fresh = list.filter((n) => n.id == null);
	const idOf = new Map<string, number>();
	list.forEach((n) => n.id != null && idOf.set(n.key, n.id));
	if (fresh.length) {
		const results = await db.batch(
			fresh.map((n) => db.prepare(`INSERT INTO lp_nodes (person_id, kind, slug, label) VALUES (?, ?, ?, ?) RETURNING id`).bind(p.id, n.kind, slugFor(n), str(n.label, 120))),
		);
		fresh.forEach((n, i) => idOf.set(n.key, (results[i].results[0] as { id: number }).id));
	}

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
				n.kind === 'support' || n.kind === 'text' ? str(n.body, 5000) : '',
				pos,
				idOf.get(n.key)!,
				p.id,
			);
	});
	const styles = list.map((n) =>
		db
			.prepare(
				`INSERT INTO lp_node_meta (node_id, tint, zoom, day, highlight) VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(node_id) DO UPDATE SET tint = excluded.tint, zoom = excluded.zoom, day = excluded.day, highlight = excluded.highlight`,
			)
			.bind(idOf.get(n.key)!, String(n.tint ?? '').toLowerCase(), cleanZoom(n.zoom), String(n.day ?? ''), n.highlight ? 1 : 0),
	);
	const darks = list.map((n) =>
		db
			.prepare(
				`INSERT INTO lp_node_dark (node_id, linked, icon, tint, zoom) VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(node_id) DO UPDATE SET linked = excluded.linked, icon = excluded.icon, tint = excluded.tint, zoom = excluded.zoom`,
			)
			.bind(idOf.get(n.key)!, n.dk_linked === false || n.dk_linked === 0 ? 0 : 1, n.dk_icon ?? '', String(n.dk_tint ?? '').toLowerCase(), cleanZoom(n.dk_zoom)),
	);
	// Older items with placeholder addresses ("group-5", "text") take their name's, once.
	const placeholder = /^(group|entry|text|note)(-\d+)?$|^group-new-group(-\d+)?$/;
	const renames = list
		.filter((n) => n.id != null && n.kind !== 'link' && placeholder.test(existingById.get(n.id)!.slug) && slugify(n.label) !== 'link')
		.map((n) => db.prepare('UPDATE lp_nodes SET slug = ? WHERE id = ? AND person_id = ?').bind(slugFor(n), n.id!, p.id));
	const deletes = existing.filter((r) => !keep.has(r.id)).map((r) => db.prepare('DELETE FROM lp_nodes WHERE id = ? AND person_id = ?').bind(r.id, p.id));
	const imagesBefore = await imagesInUse(db, p.id);
	try {
		await db.batch([...updates, ...renames, ...styles, ...darks, ...deletes, db.prepare('UPDATE lp_people SET updated_at = ? WHERE id = ?').bind(nowIso(), p.id)]);
	} catch (e) {
		if (fresh.length) await db.batch(fresh.map((n) => db.prepare('DELETE FROM lp_nodes WHERE id = ? AND person_id = ?').bind(idOf.get(n.key)!, p.id))).catch(() => {});
		throw e;
	}
	forgetImages(ctx, imagesBefore, await imagesInUse(db, p.id));
	const slugRows = (await db.prepare('SELECT id, slug FROM lp_nodes WHERE person_id = ?').bind(p.id).all<{ id: number; slug: string }>()).results;
	const slugById = new Map(slugRows.map((r) => [r.id, r.slug]));
	return json({ ok: true, ids: Object.fromEntries(idOf), slugs: Object.fromEntries([...idOf].map(([k, id]) => [k, slugById.get(id)])) });
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
	const mine = await ctx.env.LINKS_BUCKET.list({ prefix: `${p.handle}/`, limit: 400 });
	if (mine.objects.length >= 300) return fail('You have uploaded 300 pictures, the most a page can have', 429);
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
	const h = u.hostname.toLowerCase().replace(/\.+$/, '');
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
	// Only the head matters, and a short string keeps the regular expressions below cheap on hostile pages.
	let html = new TextDecoder().decode(got.bytes.subarray(0, 96_000));
	const headEnd = html.search(/<\/head>/i);
	if (headEnd > 0) html = html.slice(0, headEnd);
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
	const site = ctx.request.headers.get('sec-fetch-site');
	if (site && site !== 'same-origin') return fail('Only for the editor', 403);
	const u = publicUrl(new URL(ctx.request.url).searchParams.get('url'));
	if (!u) return fail('Not a public image address');
	try {
		const got = await fetchLimited(u, 'image/*', 4_000_000);
		const type = /^image\/(png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon)(;|$)/.exec(got?.res.headers.get('content-type') ?? '')?.[1];
		if (!got || !type) return fail('Could not fetch that image', 404);
		return new Response(got.bytes, {
			headers: {
				'content-type': `image/${type}`,
				'cache-control': 'private, max-age=600',
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'; sandbox",
			},
		});
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
		await db.batch([
			db.prepare(`UPDATE lp_people SET status = 'disabled' WHERE id = ?`).bind(p.id),
			db.prepare('DELETE FROM lp_sessions WHERE person_id = ?').bind(p.id),
			db.prepare('DELETE FROM lp_tokens WHERE person_id = ?').bind(p.id),
		]);
	} else if (b?.action === 'enable') {
		await db.prepare('UPDATE lp_people SET status = ? WHERE id = ?').bind(p.last_sign_in ? 'active' : 'invited', p.id).run();
	} else if (b?.action === 'email') {
		const email = str((b as { email?: string }).email, 254).toLowerCase();
		if (!EMAIL_RE.test(email)) return fail('Check the email address');
		const clash = await db.prepare('SELECT handle FROM lp_people WHERE email = ? AND id != ?').bind(email, p.id).first<{ handle: string }>();
		if (clash) return fail(`${email} already has a page (amy.bo/~${clash.handle})`);
		await db.batch([
			db.prepare('UPDATE lp_people SET email = ? WHERE id = ?').bind(email, p.id),
			db.prepare('DELETE FROM lp_sessions WHERE person_id = ?').bind(p.id),
			db.prepare('DELETE FROM lp_tokens WHERE person_id = ?').bind(p.id),
		]);
	} else if (b?.action === 'resend' && p.status === 'invited') {
		await sendLink(ctx.env, p, 'invite', orgName(ctx.env));
	} else return fail('Unknown action');
	return json({ ok: true });
}

/** POST /api/admin/links/sweep: deletes uploads no page uses (older than a day, so nothing mid-edit goes). */
export async function adminSweep(ctx: Ctx): Promise<Response> {
	const bucket = ctx.env.LINKS_BUCKET;
	if (!bucket) return fail('No image bucket is bound yet', 503);
	const b = await body<{ minAgeHours?: number }>(ctx.request);
	const minAge = Math.max(0, Number(b?.minAgeHours ?? 24)) * 36e5;
	const db = ctx.env.DB;
	const [people, nodes] = await db.batch([
		db.prepare(`SELECT photo AS v FROM lp_people WHERE photo LIKE 'r2:%'`),
		db.prepare(`SELECT image AS v FROM lp_nodes WHERE image LIKE 'r2:%'`),
	]);
	const used = new Set([...(people.results as { v: string }[]), ...(nodes.results as { v: string }[])].map((r) => r.v.slice(3)));
	let cursor: string | undefined;
	let removed = 0;
	let kept = 0;
	do {
		const page = await bucket.list({ cursor, limit: 1000 });
		const stale = page.objects.filter((o) => !used.has(o.key) && Date.now() - o.uploaded.getTime() >= minAge).map((o) => o.key);
		kept += page.objects.length - stale.length;
		if (stale.length) await bucket.delete(stale);
		removed += stale.length;
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return json({ ok: true, removed, kept });
}

export type { Env };
