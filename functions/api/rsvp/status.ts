import { handle } from '../../../server/http';
import { capacity, getEvent, getTours, registrationOpen } from '../../../server/rsvp';

/** Public availability for the booking form. Shows whether places are free, never names or exact holders. */
export const onRequestGet = handle(async ({ env, request }) => {
	const id = new URL(request.url).searchParams.get('event') || '';
	const ev = await getEvent(env, id);
	const tours = await getTours(env, ev.id);
	const cap = await capacity(env, ev, tours);
	return {
		ok: true,
		event: { id: ev.id, title: ev.title, starts_at: ev.starts_at, deadline: ev.deadline, open: registrationOpen(ev) },
		in_person_available: cap.inPerson.available,
		tours: cap.tours.map((t) => ({ id: t.id, label: t.label, available: t.available })),
	};
});
