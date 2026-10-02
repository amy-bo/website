// Link pages (amy.bo/~name and amy.bo/links): serving pages, counting clicks and views, serving uploaded images.
// Privacy: only the page, the link slug and the UTC time are stored. No IP, user agent, referrer or cookie.
import type { Env as EventsEnv } from '../../eventsandeye/src/env';
import { HANDLE_RE, loadDiary, loadPage, walk } from './model';
import { BOOT, renderDiary, renderPage } from './render';

export interface Env extends EventsEnv {
	LINKS_BUCKET?: R2Bucket;
}
export type Ctx = EventContext<Env, string, Record<string, unknown>>;

const ORIGIN = 'https://amy.bo';

/** Crawlers, link previews and prefetches aren't people; they're not counted (and nothing about them is stored). */
export const notAPerson = (req: Request) =>
	/bot|crawl|spider|preview|slurp|facebookexternalhit|embedly|whatsapp|telegram|discord|curl|wget|python|headless|lighthouse/i.test(req.headers.get('user-agent') ?? '') ||
	/prefetch|prerender/i.test(req.headers.get('sec-purpose') ?? req.headers.get('purpose') ?? '');

const count = (ctx: Ctx, page: string, slug: string) => {
	if (!ctx.env.DB || notAPerson(ctx.request)) return;
	ctx.waitUntil(
		ctx.env.DB.prepare('INSERT INTO link_events (page, slug) VALUES (?, ?)')
			.bind(page, slug)
			.run()
			.catch((e) => console.error('link count failed', e)),
	);
};

// The page's one inline script (the map loader) is allowed by its hash; nothing else inline can run.
let bootHash = '';
async function scriptHash(): Promise<string> {
	if (!bootHash) {
		const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(BOOT)));
		bootHash = `'sha256-${btoa(String.fromCharCode(...d))}'`;
	}
	return bootHash;
}

const html = async (body: string, status = 200) =>
	new Response(body, {
		status,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-cache',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'strict-origin-when-cross-origin',
			'content-security-policy': `default-src 'self'; img-src 'self' data: https:; style-src 'unsafe-inline'; script-src 'self' ${await scriptHash()}; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`,
		},
	});

const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location, 'cache-control': 'no-store' } });

function notFound(): Promise<Response> {
	return html(
		`<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><body style="font-family:system-ui,sans-serif;max-width:30rem;margin:4rem auto;padding:0 1rem;text-align:center"><h1>No page here</h1><p>There's no link page at this address. <a href="https://amybo.org/">Visit AMYBO</a>.</p></body></html>`,
		404,
	);
}

/** Serves /~<handle>/… (and /links/… for AMYBO). `rest` is the path after the page, already split. */
export async function servePage(ctx: Ctx, handle: string, rest: string[]): Promise<Response> {
	if (!HANDLE_RE.test(handle)) return await notFound();
	const base = handle === 'amybo' ? '/links' : `/~${handle}`;
	const [first, ...more] = rest;
	if (first === 'go') {
		let slug = '';
		try {
			slug = decodeURIComponent(more[0] ?? '');
		} catch {
			return notFound();
		}
		const row = await ctx.env.DB.prepare(
			`SELECT n.url FROM lp_nodes n JOIN lp_people p ON p.id = n.person_id WHERE p.handle = ? AND p.status = 'active' AND n.slug = ? AND n.kind = 'link'`,
		)
			.bind(handle, slug)
			.first<{ url: string }>();
		// Relative, so it stays on amy.bo when the amy.bo Worker proxies the request here.
		if (!row || !/^(https?:|mailto:)/i.test(row.url)) return redirect(base);
		count(ctx, handle, slug);
		return redirect(row.url);
	}
	const data = await loadPage(ctx.env.DB, handle);
	if (!data) return notFound();
	if (first === 'diary') {
		if (![...walk(data.roots)].some((n) => n.kind === 'diary')) return redirect(base);
		const q = new URL(ctx.request.url).searchParams.get('view');
		const view = q === 'all' || q === 'highlights' ? q : data.person.diary_default === 'highlights' && data.highlightCount ? 'highlights' : 'all';
		const entries = await loadDiary(ctx.env.DB, data.person.id, view === 'highlights');
		count(ctx, handle, '_diary');
		return html(renderDiary(data, entries, view, { origin: ORIGIN }));
	}
	if (first) return redirect(base);
	count(ctx, handle, '_view');
	return html(renderPage(data, { origin: ORIGIN }));
}

/** GET /links/media/<key>: an uploaded image from the R2 bucket. Keys are random, so they're cached for a year. */
export async function serveMedia(ctx: Ctx, key: string): Promise<Response> {
	if (!ctx.env.LINKS_BUCKET || !/^[a-z0-9-]+\/[A-Za-z0-9_-]+\.(webp|png|jpe?g|gif)$/.test(key)) return new Response('Not found', { status: 404 });
	const obj = await ctx.env.LINKS_BUCKET.get(key);
	if (!obj) return new Response('Not found', { status: 404 });
	const headers = new Headers();
	obj.writeHttpMetadata(headers);
	headers.set('cache-control', 'public, max-age=31536000, immutable');
	headers.set('x-content-type-options', 'nosniff');
	return new Response(obj.body, { headers });
}

const restOf = (ctx: Ctx) => ([] as string[]).concat(ctx.params.rest ?? []).filter(Boolean);

/** Function entry for functions/[page]/…: only paths starting /~ are link pages; everything else falls through. */
export const onTildeRequest = async (ctx: Ctx) => {
	let page = '';
	try {
		page = decodeURIComponent(String(ctx.params.page ?? ''));
	} catch {
		return ctx.next();
	}
	if (!page.startsWith('~')) return ctx.next();
	const handle = page.slice(1).toLowerCase();
	const rest = restOf(ctx);
	if (handle === 'amybo') return redirect(`/links${rest.length ? `/${rest.join('/')}` : ''}`, 301);
	if (page.slice(1) !== handle) return redirect(`/~${handle}${rest.length ? `/${rest.join('/')}` : ''}`, 301);
	return servePage(ctx, handle, rest);
};

/** Function entry for functions/links/…: AMYBO's own page, its images, and (falling through) the editor. */
export const onLinksRequest = async (ctx: Ctx) => {
	const rest = restOf(ctx);
	if (rest[0] === 'edit') return ctx.next();
	if (rest[0] === 'media') return serveMedia(ctx, rest.slice(1).join('/'));
	return servePage(ctx, 'amybo', rest);
};
