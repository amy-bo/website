// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { checkAccess } from '../../access';
import type { Ctx } from '../../http';
import { bad } from '../../util';

/** Defence in depth behind the Cloudflare Access policy: every admin API call must carry a valid Access JWT. */
export const apiMiddleware = async (ctx: Ctx) => {
	const r = await checkAccess(ctx.env, ctx.request);
	if (r.email === null) return bad(`Not authorised: ${r.reason}.`, 401);
	const email = r.email;
	if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
		const origin = ctx.request.headers.get('origin');
		if (origin && origin !== new URL(ctx.request.url).origin) return bad('Cross-origin request refused', 403);
		// Browsers also say where a request came from; anything but this site (or no browser at all) is refused.
		const site = ctx.request.headers.get('sec-fetch-site');
		if (site && site !== 'same-origin' && site !== 'none') return bad('Cross-site request refused', 403);
		const hasBody = ctx.request.method !== 'DELETE' || ctx.request.headers.has('content-length');
		if (hasBody && (ctx.request.headers.get('content-type') ?? '').split(';')[0].trim() !== 'application/json') return bad('Admin changes must be sent as JSON', 415);
	}
	ctx.data.adminEmail = email;
	const res = await ctx.next();
	const out = new Response(res.body, res);
	out.headers.set('cache-control', 'no-store');
	out.headers.set('x-robots-tag', 'noindex');
	return out;
};

/** The admin page itself is refused without a valid Access JWT, even if the Access policy were misconfigured. */
export const pageMiddleware = async (ctx: Ctx) => {
	const r = await checkAccess(ctx.env, ctx.request);
	if (r.email === null) {
		return new Response(`Not authorised: ${r.reason}. This page is protected by Cloudflare Access with two-factor sign-in.`, { status: 401, headers: { 'content-type': 'text/plain', 'x-robots-tag': 'noindex' } });
	}
	const res = await ctx.next();
	const out = new Response(res.body, res);
	out.headers.set('cache-control', 'no-store');
	out.headers.set('x-robots-tag', 'noindex');
	return out;
};
