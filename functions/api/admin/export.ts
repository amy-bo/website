import { handle } from '../../../server/http';
import { adminSummary, audienceRecipients, parseAudience, registrationsCsv } from '../../../server/rsvp';

/** ?format=csv (all registrations) or ?format=bcc (confirmed attendees' addresses, comma separated, for Gmail BCC). */
export const onRequestGet = handle(async ({ env, request }) => {
	const url = new URL(request.url);
	const event = url.searchParams.get('event') || '';
	if (url.searchParams.get('format') === 'bcc') {
		const audience = parseAudience(JSON.parse(url.searchParams.get('audience') || '{}'));
		const regs = await audienceRecipients(env, event, audience);
		return { ok: true, count: regs.length, bcc: regs.map((r) => r.email).join(', ') };
	}
	const s = await adminSummary(env, event);
	return new Response(registrationsCsv(s.registrations, s.tours), {
		headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${event}-registrations.csv"` },
	});
});
