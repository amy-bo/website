// Pages applies public/_headers to static files only, so every Function response gets its security headers here.
// Headers a handler (or a deeper middleware) already set win: link pages send their own CSP (frame-ancestors 'self',
// for the editor's preview).
type Ctx = EventContext<unknown, string, Record<string, unknown>>;

export const onRequest = async (ctx: Ctx) => {
	const res = await ctx.next();
	const path = new URL(ctx.request.url).pathname;
	const admin = path.startsWith('/admin/');
	const quiet = admin || path.startsWith('/api/');
	const add: Record<string, string> = {
		'x-content-type-options': 'nosniff',
		'referrer-policy': quiet ? 'no-referrer' : 'strict-origin-when-cross-origin',
		'strict-transport-security': 'max-age=31536000; includeSubDomains',
		...(admin ? { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" } : {}),
	};
	// A copy, because responses from fetch or Response.redirect have immutable headers.
	const out = new Response(res.body, res);
	for (const [k, v] of Object.entries(add)) if (!out.headers.has(k)) out.headers.set(k, v);
	return out;
};
