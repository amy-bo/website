import { handle, readJson } from '../../../server/http';
import { audienceRecipients, createMessage, listMessages, parseAudience } from '../../../server/rsvp';

export const onRequestGet = handle(async ({ env, request }) => ({ ok: true, messages: await listMessages(env, new URL(request.url).searchParams.get('event') || '') }));

/** Send now, or schedule with scheduled_at (ISO). { dry_run: true } returns the recipient count only. */
export const onRequestPost = handle(async ({ env, request, data }) => {
	const body = await readJson(request);
	const event = String(body.event || '');
	if (body.dry_run === true) return { ok: true, count: (await audienceRecipients(env, event, parseAudience(body.audience))).length };
	return { ok: true, message: await createMessage(env, event, body, data.adminEmail || 'admin') };
});
