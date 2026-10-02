// Click stats for the amy.bo/~<handle> link pages. Behind Cloudflare Access via ../_middleware.ts.
import { PAGES, ensureSchema } from '../../../src/links/server';
import { allLinks } from '../../../src/links/types';

interface Env { DB: D1Database }

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
	await ensureSchema(env.DB);
	const { results } = await env.DB.prepare(
		`SELECT page, slug, COUNT(*) AS total,
			SUM(at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')) AS d30,
			SUM(at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days')) AS d7,
			MIN(at) AS first
		 FROM link_events GROUP BY page, slug`,
	).all<{ page: string; slug: string; total: number; d30: number; d7: number; first: string }>();
	const get = (page: string, slug: string) => results.find((r) => r.page === page && r.slug === slug) ?? { total: 0, d30: 0, d7: 0 };

	const sections = PAGES.map((p) => {
		const v = get(p.handle, '_view');
		const rows = allLinks(p).map((l) => {
			const c = get(p.handle, l.slug);
			return { l, c, all: (l.seed ?? 0) + c.total };
		});
		const clicks = rows.reduce((n, r) => n + r.c.total, 0);
		const rate = v.total ? `${Math.round((clicks / v.total) * 100)}%` : 'n/a';
		return `<h2><a href="/~${esc(p.handle)}/">amy.bo/~${esc(p.handle)}</a></h2>
<p>Page views: <b>${v.total}</b> (7 days ${v.d7}, 30 days ${v.d30}). Clicks here: <b>${clicks}</b>, ${rate} of views.</p>
<table><thead><tr><th>Link</th><th>7 days</th><th>30 days</th><th>Here</th><th>Linktree</th><th>All time</th></tr></thead><tbody>
${rows
	.sort((a, b) => b.all - a.all)
	.map(({ l, c, all }) => `<tr><td><a href="${esc(l.url)}">${esc(l.label)}</a></td><td>${c.d7}</td><td>${c.d30}</td><td>${c.total}</td><td>${l.seed ?? ''}</td><td><b>${all}</b></td></tr>`)
	.join('\n')}
</tbody></table>`;
	}).join('\n');

	const html = `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link stats</title>
<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#14210f}table{border-collapse:collapse;width:100%}th,td{padding:.4rem .6rem;border-bottom:1px solid #dde5d8;text-align:right}th:first-child,td:first-child{text-align:left}th{font-size:.85rem;color:#4b5d44}a{color:#175a00}</style>
<h1>Link page stats</h1><p>Counts people only (crawlers and link previews are skipped). Nothing is stored about visitors except the link and the time.</p>
${sections}</html>`;
	return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
};
