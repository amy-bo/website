// Click and view counting for the amy.bo/~<handle> link pages (Pages Functions in functions/~<handle>/).
// Privacy: only the page, the link slug and the UTC time are stored. No IP, user agent, referrer or cookie.
import { allLinks, type LinkPage } from './types';
import martin from './martin';

export const PAGES: LinkPage[] = [martin];

interface Env { DB: D1Database }
type Ctx = EventContext<Env, string, Record<string, unknown>>;

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS link_events (id INTEGER PRIMARY KEY, page TEXT NOT NULL, slug TEXT NOT NULL, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`,
	`CREATE INDEX IF NOT EXISTS link_events_page_slug_at ON link_events(page, slug, at)`,
];

/** Crawlers, link previews and prefetches aren't people; they're not counted (and nothing about them is stored). */
const notAPerson = (req: Request) =>
	/bot|crawl|spider|preview|slurp|facebookexternalhit|embedly|whatsapp|telegram|discord|curl|wget|python|headless/i.test(req.headers.get('user-agent') ?? '') ||
	/prefetch|prerender/i.test(req.headers.get('sec-purpose') ?? req.headers.get('purpose') ?? '');

export async function ensureSchema(db: D1Database) {
	await db.batch(SCHEMA.map((s) => db.prepare(s)));
}

async function record(db: D1Database, page: string, slug: string) {
	const insert = () => db.prepare('INSERT INTO link_events (page, slug) VALUES (?, ?)').bind(page, slug).run();
	try {
		await insert();
	} catch (e) {
		if (!/no such table/i.test(String(e))) throw e;
		await ensureSchema(db);
		await insert();
	}
}

const count = (ctx: Ctx, page: string, slug: string) => {
	if (!ctx.env.DB || notAPerson(ctx.request)) return;
	ctx.waitUntil(record(ctx.env.DB, page, slug).catch((e) => console.error('link count failed', e)));
};

/** GET /~<handle>/go/<slug>: count the click, then send the visitor on. Unknown slugs go back to the page. */
export const goHandler = (page: LinkPage) => async (ctx: Ctx) => {
	const slug = String(ctx.params.slug ?? '');
	const link = allLinks(page).find((l) => l.slug === slug);
	if (!link) return Response.redirect(new URL(`/~${page.handle}/`, ctx.request.url).toString(), 302);
	count(ctx, page.handle, slug);
	return new Response(null, { status: 302, headers: { location: link.url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer-when-downgrade' } });
};

/** GET /~<handle>/: count a page view, then serve the static page. */
export const viewHandler = (page: LinkPage) => async (ctx: Ctx) => {
	const res = await ctx.next();
	// /~<handle> without the slash is a redirect to the page, not a view.
	if (res.status === 200) count(ctx, page.handle, '_view');
	return res;
};
