import { verifyAccess } from '../../server/access';
import type { Ctx } from '../../server/http';

/** The admin page itself is also refused without a valid Access JWT, even if the Access policy were misconfigured. */
export const onRequest = async (ctx: Ctx) => {
	if (!(await verifyAccess(ctx.env, ctx.request))) {
		return new Response('Not authorised. This page is protected by Cloudflare Access.', { status: 401, headers: { 'content-type': 'text/plain', 'x-robots-tag': 'noindex' } });
	}
	const res = await ctx.next();
	const out = new Response(res.body, res);
	out.headers.set('cache-control', 'no-store');
	out.headers.set('x-robots-tag', 'noindex');
	return out;
};
