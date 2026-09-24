import { handle } from '../../../server/http';
import { sentLogMarkdown } from '../../../server/rsvp';

export const onRequestGet = handle(async ({ env, request }) => {
	const event = new URL(request.url).searchParams.get('event') || '';
	return new Response(await sentLogMarkdown(env, event), {
		headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${event}-sent-log.md"` },
	});
});
