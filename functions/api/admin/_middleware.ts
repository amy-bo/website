import { verifyAccess } from '../../../server/access';
import type { Ctx } from '../../../server/http';
import { bad } from '../../../server/util';

/** Defence in depth behind the Cloudflare Access policy: every admin API call must carry a valid Access JWT. */
export const onRequest = async (ctx: Ctx) => {
	const email = await verifyAccess(ctx.env, ctx.request);
	if (!email) return bad('Not authorised', 401);
	if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
		const origin = ctx.request.headers.get('origin');
		if (origin && origin !== new URL(ctx.request.url).origin) return bad('Cross-origin request refused', 403);
	}
	ctx.data.adminEmail = email;
	const res = await ctx.next();
	const out = new Response(res.body, res);
	out.headers.set('cache-control', 'no-store');
	out.headers.set('x-robots-tag', 'noindex');
	return out;
};
