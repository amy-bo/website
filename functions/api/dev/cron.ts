import { isDev } from '../../../server/env';
import { handle } from '../../../server/http';
import { runScheduled } from '../../../server/rsvp';

/** Local development only: run the scheduled jobs now, optionally as if at ?at=<ISO time>. 404 on the live site. */
export const onRequestPost = handle(async ({ env, request }) => {
	if (!isDev(env)) return new Response('Not found', { status: 404 });
	const at = new URL(request.url).searchParams.get('at');
	return { ok: true, report: await runScheduled(env, at ? Date.parse(at) : Date.now()) };
});
