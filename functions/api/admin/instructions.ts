import { handle, readJson } from '../../../server/http';
import { addInstructions, listInstructions } from '../../../server/rsvp';

export const onRequestGet = handle(async ({ env, request }) => ({ ok: true, versions: await listInstructions(env, new URL(request.url).searchParams.get('event') || '') }));

/** Saves a new version. It is sent automatically only to people who confirm or are promoted from now on. */
export const onRequestPost = handle(async ({ env, request, data }) => {
	const body = await readJson(request);
	return addInstructions(env, String(body.event || ''), body, data.adminEmail || 'admin');
});
