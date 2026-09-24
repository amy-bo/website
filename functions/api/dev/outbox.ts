import { isDev } from '../../../server/env';
import { handle } from '../../../server/http';
import { json } from '../../../server/util';

/** Local development only: emails that would have been sent. 404 on the live site. */
export const onRequestGet = handle(async ({ env }) => {
	if (!isDev(env)) return new Response('Not found', { status: 404 });
	const r = await env.DB.prepare('SELECT * FROM dev_outbox ORDER BY id').all();
	return json({ ok: true, emails: r.results });
});
