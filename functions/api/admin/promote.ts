import { handle, readJson } from '../../../server/http';
import { promote } from '../../../server/rsvp';

export const onRequestPost = handle(async ({ env, request }) => {
	const body = await readJson(request);
	return promote(env, String(body.id || ''), body.what === 'tour' ? 'tour' : 'event');
});
