import { mdToHtml, mdToText } from './markdown';
import { escapeHtml, ukDateTime } from './util';
import type { OutgoingEmail } from './email';

export interface EventRow {
	id: string;
	title: string;
	starts_at: string;
	ends_at: string;
	in_person_max: number;
	deadline: string;
	page_path: string;
}

export interface TourRow {
	id: string;
	event_id: string;
	label: string;
	starts_at: string;
	capacity: number;
	sort: number;
}

export interface RegistrationRow {
	id: string;
	event_id: string;
	name: string;
	email: string;
	attendance: 'in_person' | 'remote';
	affiliation: string | null;
	needs: string | null;
	status: 'pending' | 'confirmed';
	place: 'place' | 'waitlist' | null;
	tour_id: string | null;
	tour_place: 'place' | 'waitlist' | null;
	consent_at: string;
	created_at: string;
	updated_at: string;
	confirmed_at: string | null;
	hold_expires_at: string | null;
	hold_warned_at: string | null;
	waitlist_since: string | null;
	tour_waitlist_since: string | null;
	instructions_version: number;
}

const BLUE = '#0069a0'; // brand blue #008BD2 darkened for WCAG AA contrast with white text

function layout(title: string, bodyHtml: string, footerHtml = ''): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f7f2;font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-size:20px;font-weight:bold;margin:0 0 16px"><span style="color:${BLUE}">AMY</span><span style="color:#4a7a12">BO</span></p>
<div style="background:#fff;border-radius:8px;padding:24px">${bodyHtml}</div>
<p style="font-size:12px;color:#555;margin-top:16px">${footerHtml}AMYBO is a not-for-profit trading name of andeye Ltd, registered in Scotland, company number SC665704. Questions? Reply to this email or write to <a href="mailto:hello@amybo.org">hello@amybo.org</a>. <a href="https://amybo.org/privacy/">Privacy notice</a>.</p>
</div></body></html>`;
}

function button(href: string, label: string): string {
	return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:${BLUE};color:#fff;text-decoration:none;font-weight:bold;font-size:18px;padding:14px 24px;border-radius:6px;display:inline-block">${escapeHtml(label)}</a></p>`;
}

function statusLines(reg: RegistrationRow, tours: TourRow[]): { html: string; text: string } {
	const lines: string[] = [];
	if (reg.attendance === 'remote') lines.push('You are registered to join the talks remotely on Google Meet.');
	else if (reg.place === 'waitlist') lines.push('You are on the waiting list for an in-person place. We will email you if a place becomes available.');
	else lines.push('You have an in-person place.');
	if (reg.attendance === 'in_person' && reg.tour_id) {
		const t = tours.find((x) => x.id === reg.tour_id);
		if (t) lines.push(reg.tour_place === 'waitlist' ? `You are on the waiting list for the ${t.label}.` : `You are booked on the ${t.label}.`);
	}
	return { html: lines.map((l) => `<p><strong>${escapeHtml(l)}</strong></p>`).join(''), text: lines.join('\n') };
}

export function confirmEmail(ev: EventRow, reg: RegistrationRow, confirmUrl: string, manageUrl: string): OutgoingEmail {
	const subject = `Complete your registration: ${ev.title}`;
	const html = layout(subject, `
<h1 style="font-size:22px;margin-top:0">Please complete your registration</h1>
<p>Hello ${escapeHtml(reg.name)},</p>
<p>Thanks for registering for the <strong>${escapeHtml(ev.title)}</strong> on ${escapeHtml(ukDateTime(ev.starts_at))}.</p>
<p><strong>Your registration is not complete yet.</strong> Please confirm your email address by clicking the button below. Until you do, we are holding your place, and unconfirmed registrations are deleted automatically.</p>
${button(confirmUrl, 'Complete registration')}
<p style="font-size:14px">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(confirmUrl)}">${escapeHtml(confirmUrl)}</a></p>
<p style="font-size:14px">You can view, change or cancel your registration at any time: <a href="${escapeHtml(manageUrl)}">manage my registration</a>.</p>
<p style="font-size:14px">If you did not register, ignore this email and the registration will be deleted.</p>`);
	const text = `Hello ${reg.name},

Thanks for registering for the ${ev.title} on ${ukDateTime(ev.starts_at)}.

YOUR REGISTRATION IS NOT COMPLETE YET. Please confirm your email address by opening this link and clicking "Complete registration":
${confirmUrl}

Until you do, we are holding your place, and unconfirmed registrations are deleted automatically.

View, change or cancel your registration: ${manageUrl}

If you did not register, ignore this email and the registration will be deleted.

AMYBO – hello@amybo.org – Privacy notice: https://amybo.org/privacy/`;
	return { to: reg.email, subject, html, text };
}

export function alreadyRegisteredEmail(ev: EventRow, reg: RegistrationRow, manageUrl: string): OutgoingEmail {
	const subject = `Your registration: ${ev.title}`;
	const html = layout(subject, `
<p>Hello ${escapeHtml(reg.name)},</p>
<p>Someone (hopefully you) tried to register this email address for the <strong>${escapeHtml(ev.title)}</strong>, but it is already registered.</p>
<p>You can view, change or cancel your existing registration here:</p>
${button(manageUrl, 'Manage my registration')}`);
	const text = `Hello ${reg.name},\n\nSomeone (hopefully you) tried to register this email address for the ${ev.title}, but it is already registered.\n\nView, change or cancel your registration: ${manageUrl}\n\nAMYBO – hello@amybo.org`;
	return { to: reg.email, subject, html, text };
}

export function instructionsEmail(
	ev: EventRow, reg: RegistrationRow, tours: TourRow[], instr: { subject: string; body_md: string }, manageUrl: string,
): OutgoingEmail {
	const st = statusLines(reg, tours);
	const html = layout(instr.subject, `
<p>Hello ${escapeHtml(reg.name)},</p>
${st.html}
${mdToHtml(instr.body_md)}
${button(manageUrl, 'Manage my registration')}`);
	const text = `Hello ${reg.name},\n\n${st.text}\n\n${mdToText(instr.body_md)}\n\nView, change or cancel your registration: ${manageUrl}\n\nAMYBO – hello@amybo.org – Privacy notice: https://amybo.org/privacy/`;
	return { to: reg.email, subject: instr.subject, html, text };
}

export function messageEmail(reg: RegistrationRow, msg: { subject: string; body_md: string }, manageUrl: string): OutgoingEmail {
	const html = layout(msg.subject, `<p>Hello ${escapeHtml(reg.name)},</p>${mdToHtml(msg.body_md)}<p style="font-size:14px;margin-top:24px"><a href="${escapeHtml(manageUrl)}">Manage or cancel my registration</a></p>`,
		'You are receiving this because you registered for an AMYBO event. ');
	const text = `Hello ${reg.name},\n\n${mdToText(msg.body_md)}\n\nManage or cancel your registration: ${manageUrl}\n\nYou are receiving this because you registered for an AMYBO event.\nAMYBO – hello@amybo.org`;
	return { to: reg.email, subject: msg.subject, html, text };
}

export function cancellationEmail(ev: EventRow, reg: Pick<RegistrationRow, 'name' | 'email'>, eventUrl: string): OutgoingEmail {
	const subject = `Registration cancelled: ${ev.title}`;
	const html = layout(subject, `
<p>Hello ${escapeHtml(reg.name)},</p>
<p>Your registration for the <strong>${escapeHtml(ev.title)}</strong> has been cancelled and your details have been deleted.</p>
<p>If this was a mistake, you are welcome to <a href="${escapeHtml(eventUrl)}">register again</a> while registration is open.</p>`);
	const text = `Hello ${reg.name},\n\nYour registration for the ${ev.title} has been cancelled and your details have been deleted.\n\nIf this was a mistake, you are welcome to register again while registration is open: ${eventUrl}\n\nAMYBO – hello@amybo.org`;
	return { to: reg.email, subject, html, text };
}

/** Plain internal notification to hello@amybo.org. */
export function notification(to: string, subject: string, lines: string[]): OutgoingEmail {
	const text = lines.join('\n');
	return { to, subject: `[amybo.org] ${subject}`, text, html: layout(subject, lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')) };
}
