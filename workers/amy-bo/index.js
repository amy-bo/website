// amy.bo: short links, plus the link pages served from the amybo Pages project under the amy.bo address.
// Deployed by .github/workflows/deploy.yml (see README "amy.bo"). Test: node --test workers/amy-bo/index.test.mjs

// Exact short links (lower case, no trailing slash). 301 for permanent ones.
const REDIRECTS = {
	'/': 'https://amybo.org',
	'/signup': 'https://amybo.us17.list-manage.com/subscribe?u=6f309c6b041857567b9962872&id=c1cd11b645',
	'/forum': 'https://forum.amybo.org',
	'/video': 'https://www.youtube.com/@amybo',
	'/tube': 'https://www.youtube.com/@amybo',
	'/youtube': 'https://www.youtube.com/@amybo',
	'/code': 'https://github.com/amy-bo',
	'/repo': 'https://github.com/amy-bo',
	'/docs': 'https://amybo.org/docs',
	'/prints': 'https://www.printables.com/@AMYBO_2001380',
	'/martin': 'https://www.linkedin.com/in/martincurrie/',
	'/martin-links': 'https://amy.bo/~martin',
	'/~gerrit': 'https://gerritniezen.com',
	'/anode': 'https://amybo.org/docs/experiments/electrolysis/',
	'/ep': 'https://amybo.org/docs/electropioreactor/',
	'/electropioreactor': 'https://amybo.org/docs/electropioreactor/',
	'/brand': 'https://github.com/amy-bo/branding',
};
// Short links that may change (302).
const TEMPORARY = {
	'/media': 'https://github.com/amy-bo/electroPioreactor/tree/main/Media',
	// The next AMYBO Event; repoint it when the next one is announced.
	'/event': 'https://amybo.org/events/2026-11-13-london/',
};

/** Paths served from the Pages project, keeping the amy.bo address. */
const proxied = (path) =>
	path.startsWith('/~') || path === '/links' || path.startsWith('/links/') || path.startsWith('/link-media/') || path.startsWith('/link-assets/') || path === '/favicon.svg';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.hostname === 'www.amy.bo') return Response.redirect(`https://amy.bo${url.pathname}${url.search}`, 301);

		let path = url.pathname.toLowerCase();
		if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
		if (REDIRECTS[path]) return Response.redirect(REDIRECTS[path], 301);
		if (TEMPORARY[path]) return Response.redirect(TEMPORARY[path], 302);

		// The editor and its API live on the main site, where sign-in cookies belong.
		if (path === '/links/edit' || path.startsWith('/links/edit/')) return Response.redirect(`${env.SITE}/links/edit/`, 302);

		if (proxied(url.pathname)) {
			const origin = new URL(env.PAGES_ORIGIN);
			const target = new URL(url.pathname + url.search, origin);
			const fwd = new Request(target, request);
			// Nothing of the visitor's amy.bo credentials needs to reach the Pages project.
			fwd.headers.delete('cookie');
			fwd.headers.delete('authorization');
			const res = await fetch(fwd, { redirect: 'manual' });
			const out = new Response(res.body, res);
			// Keep redirects on amy.bo: the Pages project answers with its own host or with relative paths.
			const loc = res.headers.get('location');
			if (loc) {
				const l = new URL(loc, target);
				if (l.host === origin.host) out.headers.set('location', `https://amy.bo${l.pathname}${l.search}`);
			}
			return out;
		}

		// Anything else: the same path on the main site.
		return Response.redirect(`https://amybo.org${url.pathname}${url.search}`, 302);
	},
};
