import { handle, readJson } from '../../../server/http';
import { updateSettings } from '../../../server/rsvp';

export const onRequestPost = handle(async ({ env, request }) => {
	const body = await readJson(request);
	return updateSettings(env, String(body.event || ''), body);
});
