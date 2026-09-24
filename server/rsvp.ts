import { type Env, notifyEmail, siteUrl } from './env';
import { sendBatch, sendEmail, type OutgoingEmail } from './email';
import {
	cancellationEmail, confirmEmail, instructionsEmail, messageEmail, notification,
	type EventRow, type RegistrationRow, type TourRow,
} from './templates';
import { makeToken } from './tokens';
import { cleanText, EMAIL_RE, nowIso, randomToken } from './util';

const HOUR = 3600_000;
export const MAX_HOLD_MS = 48 * HOUR;

export class UserError extends Error {
	constructor(message: string, public status = 400) {
		super(message);
	}
}

// ---------- reads ----------

export async function getEvent(env: Env, id: string): Promise<EventRow> {
	const ev = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
	if (!ev) throw new UserError('Unknown event', 404);
	return ev;
}

export async function getTours(env: Env, eventId: string): Promise<TourRow[]> {
	const r = await env.DB.prepare('SELECT * FROM tours WHERE event_id = ? ORDER BY sort').bind(eventId).all<TourRow>();
	return r.results;
}

export async function getRegistration(env: Env, id: string): Promise<RegistrationRow | null> {
	return env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first<RegistrationRow>();
}

export async function latestInstructions(env: Env, eventId: string) {
	return env.DB.prepare('SELECT * FROM instructions WHERE event_id = ? ORDER BY version DESC LIMIT 1')
		.bind(eventId)
		.first<{ event_id: string; version: number; subject: string; body_md: string; change_note: string | null; created_at: string }>();
}

/**
 * Places are "held" by confirmed registrations and by pending ones whose hold has not expired.
 * A place is only offered when a seat is free AND nobody confirmed is waiting: freed places go to the
 * waiting list first, and only an admin promotes people off it.
 */
export async function capacity(env: Env, ev: EventRow, tours: TourRow[], now = nowIso()) {
	const held = `(status = 'confirmed' OR (status = 'pending' AND hold_expires_at > ?))`;
	const inPerson = await env.DB.prepare(
		`SELECT
			SUM(CASE WHEN attendance='in_person' AND place='place' AND ${held} THEN 1 ELSE 0 END) AS held,
			SUM(CASE WHEN attendance='in_person' AND place='waitlist' AND status='confirmed' THEN 1 ELSE 0 END) AS waiting,
			SUM(CASE WHEN attendance='in_person' AND place='place' AND status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
			SUM(CASE WHEN attendance='remote' AND status='confirmed' THEN 1 ELSE 0 END) AS remote,
			SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
		 FROM registrations WHERE event_id = ?`,
	).bind(now, ev.id).first<Record<string, number | null>>();
	const tourRows = await env.DB.prepare(
		`SELECT tour_id,
			SUM(CASE WHEN tour_place='place' AND ${held} THEN 1 ELSE 0 END) AS held,
			SUM(CASE WHEN tour_place='place' AND status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
			SUM(CASE WHEN tour_place='waitlist' AND status='confirmed' THEN 1 ELSE 0 END) AS waiting
		 FROM registrations WHERE event_id = ? AND tour_id IS NOT NULL GROUP BY tour_id`,
	).bind(now, ev.id).all<{ tour_id: string; held: number; confirmed: number; waiting: number }>();
	const n = (x: number | null | undefined) => x ?? 0;
	return {
		inPerson: {
			max: ev.in_person_max, held: n(inPerson?.held), confirmed: n(inPerson?.confirmed), waiting: n(inPerson?.waiting),
			available: n(inPerson?.held) < ev.in_person_max && n(inPerson?.waiting) === 0,
		},
		remote: n(inPerson?.remote),
		pending: n(inPerson?.pending),
		tours: tours.map((t) => {
			const r = tourRows.results.find((x) => x.tour_id === t.id);
			const held = n(r?.held), waiting = n(r?.waiting);
			return { id: t.id, label: t.label, starts_at: t.starts_at, capacity: t.capacity, held, confirmed: n(r?.confirmed), waiting, available: held < t.capacity && waiting === 0 };
		}),
	};
}

export const registrationOpen = (ev: EventRow, now = Date.now()) => now < Date.parse(ev.deadline);

/** Hold for unconfirmed registrations: the shorter of 48 hours or a third of the time left to the deadline. */
export function holdMs(ev: EventRow, now = Date.now()): number {
	const third = Math.max(0, (Date.parse(ev.deadline) - now) / 3);
	return Math.max(15 * 60_000, Math.min(MAX_HOLD_MS, third));
}

export async function manageUrl(env: Env, id: string) {
	return `${siteUrl(env)}/events/manage/?t=${encodeURIComponent(await makeToken(env, 'manage', id))}`;
}
export async function confirmUrl(env: Env, id: string) {
	return `${siteUrl(env)}/events/confirm/?t=${encodeURIComponent(await makeToken(env, 'confirm', id))}`;
}

async function recordDelivery(env: Env, regId: string, kind: string, providerId: string, extra: { messageId?: string; version?: number } = {}) {
	await env.DB.prepare('INSERT INTO deliveries (registration_id, kind, message_id, instructions_version, sent_at, provider_id) VALUES (?,?,?,?,?,?)')
		.bind(regId, kind, extra.messageId ?? null, extra.version ?? null, nowIso(), providerId)
		.run();
}

// ---------- public flows ----------

export interface RegistrationInput {
	name?: unknown;
	email?: unknown;
	attendance?: unknown;
	tour_id?: unknown;
	affiliation?: unknown;
	needs?: unknown;
	consent?: unknown;
}

function parseCommon(input: RegistrationInput, tours: TourRow[]) {
	const name = cleanText(input.name, 120);
	if (!name) throw new UserError('Please enter your name.');
	const attendance = input.attendance === 'remote' ? 'remote' : input.attendance === 'in_person' ? 'in_person' : null;
	if (!attendance) throw new UserError('Please choose in person or remote.');
	let tour_id: string | null = null;
	if (attendance === 'in_person' && input.tour_id && input.tour_id !== 'none') {
		const t = tours.find((x) => x.id === input.tour_id);
		if (!t) throw new UserError('Unknown tour.');
		tour_id = t.id;
	}
	return { name, attendance, tour_id, affiliation: cleanText(input.affiliation, 200), needs: cleanText(input.needs, 1000) } as const;
}

/**
 * Creates a pending registration and sends the confirm-your-email message. The response is identical whether or not
 * the address was already registered: a pending duplicate gets the confirm-your-email message again, a confirmed
 * duplicate gets no email at all (it is not on the list of permitted automatic emails).
 */
export async function register(env: Env, eventId: string, input: RegistrationInput) {
	const ev = await getEvent(env, eventId);
	if (!registrationOpen(ev)) throw new UserError('Registration for this event has closed.', 409);
	if (input.consent !== true && input.consent !== 'on' && input.consent !== 'true') throw new UserError('Please tick the consent box to register.');
	const tours = await getTours(env, ev.id);
	const c = parseCommon(input, tours);
	const email = cleanText(input.email, 254)?.toLowerCase() ?? '';
	if (!EMAIL_RE.test(email)) throw new UserError('Please enter a valid email address.');

	const existing = await env.DB.prepare('SELECT * FROM registrations WHERE event_id = ? AND email = ?').bind(ev.id, email).first<RegistrationRow>();
	if (existing) {
		// Pending: re-send the confirm-your-email message. Confirmed: send nothing (the brief allows no other
		// automatic email); the generic response still gives nothing away.
		if (existing.status === 'pending') {
			await sendEmail(env, confirmEmail(ev, existing, await confirmUrl(env, existing.id), await manageUrl(env, existing.id)));
		}
		return { ok: true as const };
	}

	const now = Date.now();
	const nowS = new Date(now).toISOString();
	const cap = await capacity(env, ev, tours, nowS);
	const place = c.attendance === 'in_person' ? (cap.inPerson.available ? 'place' : 'waitlist') : null;
	const tourCap = c.tour_id ? cap.tours.find((t) => t.id === c.tour_id)! : null;
	const tour_place = tourCap ? (tourCap.available ? 'place' : 'waitlist') : null;
	const id = randomToken(16);
	const reg: RegistrationRow = {
		id, event_id: ev.id, name: c.name, email, attendance: c.attendance, affiliation: c.affiliation, needs: c.needs,
		status: 'pending', place, tour_id: c.tour_id, tour_place, consent_at: nowS, created_at: nowS, updated_at: nowS,
		confirmed_at: null, hold_expires_at: new Date(now + holdMs(ev, now)).toISOString(), hold_warned_at: null,
		waitlist_since: null, tour_waitlist_since: null, instructions_version: 0,
	};
	await env.DB.prepare(
		`INSERT INTO registrations (id, event_id, name, email, attendance, affiliation, needs, status, place, tour_id, tour_place,
			consent_at, created_at, updated_at, hold_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	).bind(reg.id, reg.event_id, reg.name, reg.email, reg.attendance, reg.affiliation, reg.needs, reg.status, reg.place, reg.tour_id,
		reg.tour_place, reg.consent_at, reg.created_at, reg.updated_at, reg.hold_expires_at).run();
	const pid = await sendEmail(env, confirmEmail(ev, reg, await confirmUrl(env, id), await manageUrl(env, id)));
	await recordDelivery(env, id, 'confirm_email', pid);
	return { ok: true as const };
}

async function sendInstructionsTo(env: Env, ev: EventRow, reg: RegistrationRow, tours: TourRow[]) {
	const instr = await latestInstructions(env, ev.id);
	if (!instr) return;
	const pid = await sendEmail(env, instructionsEmail(ev, reg, tours, instr, await manageUrl(env, reg.id)));
	await env.DB.prepare('UPDATE registrations SET instructions_version = ? WHERE id = ?').bind(instr.version, reg.id).run();
	await recordDelivery(env, reg.id, 'instructions', pid, { version: instr.version });
}

async function totalsLines(env: Env, ev: EventRow, tours: TourRow[]) {
	const cap = await capacity(env, ev, tours);
	return [
		`In person: ${cap.inPerson.confirmed} confirmed of ${cap.inPerson.max} places, ${cap.inPerson.waiting} on the waiting list.`,
		`Remote: ${cap.remote} confirmed. Unconfirmed registrations: ${cap.pending}.`,
		...cap.tours.map((t) => `${t.label}: ${t.confirmed} of ${t.capacity} booked, ${t.waiting} waiting.`),
		`Admin: ${siteUrl(env)}/admin/rsvps/`,
	];
}

/** Tells hello@ when a confirmed registrant newly joins the in-person or a tour waiting list, with current totals. */
async function notifyWaitlist(env: Env, ev: EventRow, tours: TourRow[], reg: RegistrationRow, event: boolean, tour: boolean, verb: string) {
	if (!event && !tour) return;
	const what = [event ? 'the in-person waiting list' : null, tour ? `the ${tours.find((t) => t.id === reg.tour_id)?.label} waiting list` : null].filter(Boolean).join(' and ');
	await sendEmail(env, notification(notifyEmail(env), `New waiting-list registration: ${ev.title}`, [
		`${reg.name}${reg.affiliation ? ` (${reg.affiliation})` : ''} ${verb} ${what}.`,
		...(await totalsLines(env, ev, tours)),
	]));
}

export function publicStatus(reg: RegistrationRow, tours: TourRow[]) {
	const tour = reg.tour_id ? tours.find((t) => t.id === reg.tour_id) : null;
	return {
		name: reg.name, email: reg.email, attendance: reg.attendance, affiliation: reg.affiliation, needs: reg.needs,
		status: reg.status, place: reg.place, tour_id: reg.tour_id, tour_label: tour?.label ?? null, tour_place: reg.tour_place,
		hold_expires_at: reg.status === 'pending' ? reg.hold_expires_at : null,
	};
}

/** Confirms the email address. Idempotent. Sends joining instructions unless the person is waitlisted in person. */
export async function confirm(env: Env, id: string) {
	let reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists. Unconfirmed registrations are deleted after a while, so please register again.', 404);
	const ev = await getEvent(env, reg.event_id);
	const tours = await getTours(env, ev.id);
	if (reg.status === 'confirmed') return { ok: true as const, already: true, registration: publicStatus(reg, tours) };

	const now = nowIso();
	let place = reg.place, tour_place = reg.tour_place;
	if (reg.hold_expires_at && reg.hold_expires_at <= now) {
		// Hold lapsed but not yet swept: re-check availability as if registering now (excluding this row, which no longer holds).
		const cap = await capacity(env, ev, tours, now);
		if (reg.attendance === 'in_person') place = cap.inPerson.available ? 'place' : 'waitlist';
		if (reg.tour_id) tour_place = cap.tours.find((t) => t.id === reg!.tour_id)?.available ? 'place' : 'waitlist';
	}
	const joinsWaitlist = place === 'waitlist';
	const joinsTourWaitlist = tour_place === 'waitlist';
	await env.DB.prepare(
		`UPDATE registrations SET status='confirmed', confirmed_at=?, updated_at=?, hold_expires_at=NULL, place=?, tour_place=?,
			waitlist_since = CASE WHEN ? THEN ? ELSE NULL END, tour_waitlist_since = CASE WHEN ? THEN ? ELSE NULL END
		 WHERE id=? AND status='pending'`,
	).bind(now, now, place, tour_place, joinsWaitlist ? 1 : 0, now, joinsTourWaitlist ? 1 : 0, now, id).run();
	reg = (await getRegistration(env, id))!;

	if (!joinsWaitlist) await sendInstructionsTo(env, ev, reg, tours);
	await notifyWaitlist(env, ev, tours, reg, joinsWaitlist, joinsTourWaitlist, 'has confirmed and joined');
	return { ok: true as const, already: false, registration: publicStatus(reg, tours) };
}

export async function manageView(env: Env, id: string) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	const ev = await getEvent(env, reg.event_id);
	const tours = await getTours(env, ev.id);
	const cap = await capacity(env, ev, tours);
	return {
		ok: true as const,
		event: { id: ev.id, title: ev.title, starts_at: ev.starts_at, deadline: ev.deadline, page_path: ev.page_path, open: registrationOpen(ev) },
		tours: cap.tours.map((t) => ({ id: t.id, label: t.label, available: t.available })),
		registration: publicStatus(reg, tours),
	};
}

/** Changes by the registrant. Email cannot change (cancel and re-register instead). Moves are re-checked against capacity. */
export async function updateRegistration(env: Env, id: string, input: RegistrationInput) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	const ev = await getEvent(env, reg.event_id);
	const tours = await getTours(env, ev.id);
	const c = parseCommon(input, tours);
	const now = nowIso();
	const cap = await capacity(env, ev, tours, now);

	let place = reg.place, waitlist_since = reg.waitlist_since;
	if (c.attendance === 'remote') {
		place = null;
		waitlist_since = null;
	} else if (reg.attendance === 'remote') {
		if (!registrationOpen(ev)) throw new UserError('Registration has closed, so in-person places can no longer be added. Please email hello@amybo.org.', 409);
		place = cap.inPerson.available ? 'place' : 'waitlist';
		waitlist_since = place === 'waitlist' && reg.status === 'confirmed' ? now : null;
	}
	let tour_place = reg.tour_place, tour_waitlist_since = reg.tour_waitlist_since;
	if (c.tour_id !== reg.tour_id) {
		if (c.tour_id && !registrationOpen(ev)) throw new UserError('Registration has closed, so lab tour bookings can no longer be changed. Please email hello@amybo.org.', 409);
		if (c.tour_id) {
			tour_place = cap.tours.find((t) => t.id === c.tour_id)!.available ? 'place' : 'waitlist';
			tour_waitlist_since = tour_place === 'waitlist' && reg.status === 'confirmed' ? now : null;
		} else {
			tour_place = null;
			tour_waitlist_since = null;
		}
	}
	await env.DB.prepare(
		`UPDATE registrations SET name=?, attendance=?, affiliation=?, needs=?, place=?, waitlist_since=?, tour_id=?, tour_place=?,
			tour_waitlist_since=?, updated_at=? WHERE id=?`,
	).bind(c.name, c.attendance, c.affiliation, c.needs, place, waitlist_since, c.tour_id, tour_place, tour_waitlist_since, now, id).run();
	if (reg.status === 'confirmed') {
		const updated = (await getRegistration(env, id))!;
		const newEvent = updated.place === 'waitlist' && reg.place !== 'waitlist';
		const newTour = updated.tour_place === 'waitlist' && !(reg.tour_place === 'waitlist' && reg.tour_id === updated.tour_id);
		await notifyWaitlist(env, ev, tours, updated, newEvent, newTour, 'changed their registration and joined');
	}
	return manageView(env, id);
}

/** Deletes the registration, confirms to the person and tells hello@. */
export async function cancel(env: Env, id: string) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	const ev = await getEvent(env, reg.event_id);
	const tours = await getTours(env, ev.id);
	await env.DB.prepare('DELETE FROM registrations WHERE id = ?').bind(id).run();
	await sendEmail(env, cancellationEmail(ev, reg, `${siteUrl(env)}${ev.page_path}`));
	const detail = reg.attendance === 'remote' ? 'remote' : reg.place === 'waitlist' ? 'in person, waiting list' : 'in person';
	await sendEmail(env, notification(notifyEmail(env), `Cancellation: ${ev.title}`, [
		`${reg.name}${reg.affiliation ? ` (${reg.affiliation})` : ''} cancelled (${reg.status}, ${detail}${reg.tour_id ? `, ${tours.find((t) => t.id === reg.tour_id)?.label ?? 'tour'} ${reg.tour_place ?? ''}` : ''}).`,
		...(await totalsLines(env, ev, tours)),
	]));
	return { ok: true as const };
}

// ---------- admin ----------

export async function promote(env: Env, id: string, what: 'event' | 'tour') {
	const reg = await getRegistration(env, id);
	if (!reg || reg.status !== 'confirmed') throw new UserError('Only confirmed registrations can be promoted.', 404);
	const ev = await getEvent(env, reg.event_id);
	const tours = await getTours(env, ev.id);
	if (what === 'event') {
		if (reg.attendance !== 'in_person' || reg.place !== 'waitlist') throw new UserError('This person is not on the in-person waiting list.');
		await env.DB.prepare(`UPDATE registrations SET place='place', waitlist_since=NULL, updated_at=? WHERE id=?`).bind(nowIso(), id).run();
	} else {
		if (reg.tour_place !== 'waitlist') throw new UserError('This person is not on a tour waiting list.');
		await env.DB.prepare(`UPDATE registrations SET tour_place='place', tour_waitlist_since=NULL, updated_at=? WHERE id=?`).bind(nowIso(), id).run();
	}
	const updated = (await getRegistration(env, id))!;
	// Someone still waiting for an in-person place gets instructions only once they have one.
	if (!(updated.attendance === 'in_person' && updated.place === 'waitlist')) await sendInstructionsTo(env, ev, updated, tours);
	return { ok: true as const };
}

export async function adminDelete(env: Env, id: string) {
	await env.DB.prepare('DELETE FROM registrations WHERE id = ?').bind(id).run();
	return { ok: true as const };
}

export interface Audience {
	attendance?: 'all' | 'in_person' | 'remote';
	tour_id?: string; // a tour id, 'none' for no tour, or undefined for any
	below_version?: number; // only people whose last joining instructions are older than this version
	include_waitlist?: boolean; // include people waiting for an in-person place
}

export function parseAudience(v: unknown): Audience {
	const a = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
	return {
		attendance: a.attendance === 'in_person' || a.attendance === 'remote' ? a.attendance : 'all',
		tour_id: typeof a.tour_id === 'string' && a.tour_id ? a.tour_id : undefined,
		below_version: Number.isInteger(a.below_version) && (a.below_version as number) > 0 ? (a.below_version as number) : undefined,
		include_waitlist: a.include_waitlist === true,
	};
}

export async function audienceRecipients(env: Env, eventId: string, a: Audience): Promise<RegistrationRow[]> {
	const where = [`event_id = ?`, `status = 'confirmed'`];
	const binds: unknown[] = [eventId];
	if (a.attendance && a.attendance !== 'all') { where.push('attendance = ?'); binds.push(a.attendance); }
	if (!a.include_waitlist) where.push(`NOT (attendance = 'in_person' AND place = 'waitlist')`);
	if (a.tour_id === 'none') where.push('tour_id IS NULL');
	else if (a.tour_id) { where.push('tour_id = ?'); binds.push(a.tour_id); }
	if (a.below_version) { where.push('instructions_version < ?'); binds.push(a.below_version); }
	const r = await env.DB.prepare(`SELECT * FROM registrations WHERE ${where.join(' AND ')} ORDER BY created_at`).bind(...binds).all<RegistrationRow>();
	return r.results;
}

interface MessageRow {
	id: string; event_id: string; subject: string; body_md: string; audience: string; marks_instructions_version: number | null;
	status: string; scheduled_at: string | null; sent_at: string | null; recipients_count: number | null; error: string | null;
	created_at: string; created_by: string | null;
}

export async function createMessage(env: Env, eventId: string, input: Record<string, unknown>, createdBy: string) {
	await getEvent(env, eventId);
	const subject = cleanText(input.subject, 200);
	const body = typeof input.body_md === 'string' ? input.body_md.trim().slice(0, 20000) : '';
	if (!subject || !body) throw new UserError('Subject and message are required.');
	const audience = parseAudience(input.audience);
	let scheduled_at: string | null = null;
	if (input.scheduled_at) {
		const t = Date.parse(String(input.scheduled_at));
		if (Number.isNaN(t)) throw new UserError('Invalid schedule time.');
		if (t > Date.now() + 60_000) scheduled_at = new Date(t).toISOString();
	}
	const marks = Number.isInteger(input.marks_instructions_version) && (input.marks_instructions_version as number) > 0 ? (input.marks_instructions_version as number) : null;
	const id = randomToken(12);
	await env.DB.prepare(
		`INSERT INTO messages (id, event_id, subject, body_md, audience, marks_instructions_version, status, scheduled_at, created_at, created_by)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
	).bind(id, eventId, subject, body, JSON.stringify(audience), marks, scheduled_at ? 'scheduled' : 'sending', scheduled_at, nowIso(), createdBy).run();
	if (!scheduled_at) await deliverMessage(env, id);
	return env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<MessageRow>();
}

/** Sends a message to its audience, recording each delivery. Safe to call from the cron: claims the row first. */
export async function deliverMessage(env: Env, id: string) {
	const claim = await env.DB.prepare(`UPDATE messages SET status='sending' WHERE id=? AND status IN ('scheduled','sending') RETURNING *`).bind(id).first<MessageRow>();
	if (!claim) return;
	try {
		const recipients = await audienceRecipients(env, claim.event_id, JSON.parse(claim.audience));
		const emails: OutgoingEmail[] = [];
		for (const r of recipients) emails.push(messageEmail(r, claim, await manageUrl(env, r.id)));
		const ids = await sendBatch(env, emails);
		const stmts = recipients.map((r, i) =>
			env.DB.prepare('INSERT INTO deliveries (registration_id, kind, message_id, instructions_version, sent_at, provider_id) VALUES (?,?,?,?,?,?)')
				.bind(r.id, 'message', id, claim.marks_instructions_version, nowIso(), ids[i] ?? null));
		if (claim.marks_instructions_version) {
			for (const r of recipients) stmts.push(env.DB.prepare('UPDATE registrations SET instructions_version = MAX(instructions_version, ?) WHERE id = ?').bind(claim.marks_instructions_version, r.id));
		}
		stmts.push(env.DB.prepare(`UPDATE messages SET status='sent', sent_at=?, recipients_count=? WHERE id=?`).bind(nowIso(), recipients.length, id));
		await env.DB.batch(stmts);
	} catch (e) {
		await env.DB.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).bind(String(e).slice(0, 500), id).run();
		throw e;
	}
}

export async function cancelMessage(env: Env, id: string) {
	const r = await env.DB.prepare(`UPDATE messages SET status='cancelled' WHERE id=? AND status='scheduled' RETURNING id`).bind(id).first();
	if (!r) throw new UserError('Only scheduled messages that have not started sending can be cancelled.', 409);
	return { ok: true as const };
}

export async function listMessages(env: Env, eventId: string) {
	return (await env.DB.prepare('SELECT * FROM messages WHERE event_id = ? ORDER BY COALESCE(sent_at, scheduled_at, created_at) DESC').bind(eventId).all<MessageRow>()).results;
}

export async function listInstructions(env: Env, eventId: string) {
	return (await env.DB.prepare('SELECT * FROM instructions WHERE event_id = ? ORDER BY version DESC').bind(eventId).all()).results;
}

export async function addInstructions(env: Env, eventId: string, input: Record<string, unknown>, createdBy: string) {
	await getEvent(env, eventId);
	const subject = cleanText(input.subject, 200);
	const body = typeof input.body_md === 'string' ? input.body_md.trim().slice(0, 20000) : '';
	if (!subject || !body) throw new UserError('Subject and body are required.');
	const latest = await latestInstructions(env, eventId);
	const version = (latest?.version ?? 0) + 1;
	await env.DB.prepare('INSERT INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES (?,?,?,?,?,?,?)')
		.bind(eventId, version, subject, body, cleanText(input.change_note, 1000), nowIso(), createdBy).run();
	return { ok: true as const, version };
}

export async function updateSettings(env: Env, eventId: string, input: Record<string, unknown>) {
	const ev = await getEvent(env, eventId);
	const max = input.in_person_max === undefined ? ev.in_person_max : Number(input.in_person_max);
	if (!Number.isInteger(max) || max < 0 || max > 10000) throw new UserError('In-person maximum must be a whole number.');
	let deadline = ev.deadline;
	if (input.deadline !== undefined) {
		const t = Date.parse(String(input.deadline));
		if (Number.isNaN(t)) throw new UserError('Invalid deadline.');
		deadline = new Date(t).toISOString();
	}
	const stmts = [env.DB.prepare('UPDATE events SET in_person_max=?, deadline=? WHERE id=?').bind(max, deadline, eventId)];
	if (Array.isArray(input.tours)) {
		for (const t of input.tours as { id?: unknown; capacity?: unknown }[]) {
			const capN = Number(t.capacity);
			if (typeof t.id !== 'string' || !Number.isInteger(capN) || capN < 0 || capN > 1000) throw new UserError('Invalid tour capacity.');
			stmts.push(env.DB.prepare('UPDATE tours SET capacity=? WHERE id=? AND event_id=?').bind(capN, t.id, eventId));
		}
	}
	await env.DB.batch(stmts);
	return { ok: true as const };
}

export async function adminSummary(env: Env, eventId: string) {
	const ev = await getEvent(env, eventId);
	const tours = await getTours(env, ev.id);
	const cap = await capacity(env, ev, tours);
	const regs = (await env.DB.prepare('SELECT * FROM registrations WHERE event_id = ? ORDER BY created_at').bind(ev.id).all<RegistrationRow>()).results;
	const latest = await latestInstructions(env, ev.id);
	return { ok: true as const, event: ev, tours, capacity: cap, registrations: regs, latest_instructions_version: latest?.version ?? 0 };
}

export function registrationsCsv(regs: RegistrationRow[], tours: TourRow[]): string {
	const cols = ['name', 'email', 'attendance', 'status', 'place', 'tour', 'tour_place', 'affiliation', 'needs', 'instructions_version', 'created_at', 'confirmed_at'];
	const esc = (v: unknown) => {
		let s = v == null ? '' : String(v);
		if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // defuse spreadsheet formula injection
		return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const rows = regs.map((r) => [r.name, r.email, r.attendance, r.status, r.place, tours.find((t) => t.id === r.tour_id)?.label ?? '', r.tour_place,
		r.affiliation, r.needs, r.instructions_version, r.created_at, r.confirmed_at].map(esc).join(','));
	return [cols.join(','), ...rows].join('\r\n') + '\r\n';
}

/** Markdown record of joining-instruction versions and everything sent, for review (and for Claude to draft updates). */
export async function sentLogMarkdown(env: Env, eventId: string): Promise<string> {
	const ev = await getEvent(env, eventId);
	const instr = await listInstructions(env, eventId) as { version: number; subject: string; body_md: string; change_note: string | null; created_at: string }[];
	const msgs = await listMessages(env, eventId);
	const regs = (await env.DB.prepare(`SELECT instructions_version AS v, COUNT(*) AS n FROM registrations WHERE event_id=? AND status='confirmed' GROUP BY instructions_version`).bind(eventId).all<{ v: number; n: number }>()).results;
	const out = [`# Sent log: ${ev.title}`, '', `Exported ${nowIso()}.`, '', '## Who has which joining-instructions version', '',
		...regs.map((r) => `- Version ${r.v}: ${r.n} confirmed registrant(s)${r.v === 0 ? ' (none yet: waiting list)' : ''}`), '',
		'## Joining instructions versions (newest first)', ''];
	for (const i of instr) out.push(`### Version ${i.version} – ${i.created_at}`, '', `Subject: ${i.subject}`, '', `Change note: ${i.change_note ?? '–'}`, '', i.body_md, '');
	out.push('## Messages sent or scheduled (newest first)', '');
	for (const m of msgs) {
		out.push(`### ${m.subject}`, '', `- Status: ${m.status}${m.sent_at ? `, sent ${m.sent_at}` : ''}${m.scheduled_at ? `, scheduled for ${m.scheduled_at}` : ''}`,
			`- Recipients: ${m.recipients_count ?? '–'}`, `- Audience: \`${m.audience}\``,
			`- Counts as joining instructions version: ${m.marks_instructions_version ?? '–'}`, '', m.body_md, '');
	}
	return out.join('\n');
}

// ---------- scheduled jobs (companion cron Worker, or /api/dev/cron locally) ----------

export async function runScheduled(env: Env, now = Date.now()) {
	const nowS = new Date(now).toISOString();
	const report = { messagesSent: 0, holdsWarned: 0, holdsExpired: 0, retentionDeleted: 0 };

	// 1. Scheduled messages that are due.
	const due = (await env.DB.prepare(`SELECT id FROM messages WHERE status='scheduled' AND scheduled_at <= ?`).bind(nowS).all<{ id: string }>()).results;
	for (const m of due) {
		try { await deliverMessage(env, m.id); report.messagesSent++; } catch (e) { console.error('message failed', m.id, e); }
	}

	// 2. Unconfirmed registrations: tell hello@ once half the hold has passed, delete when it expires.
	const pending = (await env.DB.prepare(`SELECT * FROM registrations WHERE status='pending'`).all<RegistrationRow>()).results;
	for (const r of pending) {
		if (!r.hold_expires_at) continue;
		const exp = Date.parse(r.hold_expires_at), start = Date.parse(r.created_at);
		if (exp <= now) {
			await env.DB.prepare(`DELETE FROM registrations WHERE id=? AND status='pending'`).bind(r.id).run();
			report.holdsExpired++;
		} else if (!r.hold_warned_at && now >= start + (exp - start) / 2) {
			const ev = await getEvent(env, r.event_id);
			await sendEmail(env, notification(notifyEmail(env), `Unconfirmed registration half way to expiry: ${ev.title}`, [
				`${r.name} <${r.email}> registered at ${r.created_at} but has not confirmed their email address.`,
				`Their ${r.attendance === 'in_person' ? (r.place === 'place' ? 'held in-person place' : 'waiting-list request') : 'remote registration'} will be deleted at ${r.hold_expires_at} unless they confirm.`,
			]));
			await env.DB.prepare('UPDATE registrations SET hold_warned_at=? WHERE id=?').bind(nowS, r.id).run();
			report.holdsWarned++;
		}
	}

	// 3. Retention: delete registrations (and their delivery records) 30 days after the event ends.
	const cutoff = new Date(now - 30 * 24 * HOUR).toISOString();
	const r = await env.DB.prepare(`DELETE FROM registrations WHERE event_id IN (SELECT id FROM events WHERE ends_at <= ?)`).bind(cutoff).run();
	report.retentionDeleted = r.meta.changes ?? 0;
	await env.DB.prepare('DELETE FROM dev_outbox WHERE created_at <= ?').bind(cutoff).run();
	return report;
}
