// Remote access to electroPioreactors (amybo.org/remote): the pure parts. People apply on the public page, confirm their
// email, and an admin assigns them to an experiment. Each experiment's Pi sits behind a Cloudflare Tunnel at its own
// hostname, guarded by a Cloudflare Access application whose allow list is the experiment's assigned people (plus the
// admins). Nobody signs in to this site: Cloudflare Access does the login, with a one-time code emailed by Cloudflare.
import { cleanLine, cleanText, EMAIL_RE } from '../../eventsandeye/src/util';

export type ExperimentStatus = 'planned' | 'open' | 'closed';
export type ApplicationStatus = 'unconfirmed' | 'pending' | 'approved' | 'rejected';

export interface ExperimentRow {
	id: number;
	name: string;
	hostname: string;
	status: ExperimentStatus;
	offered: number;
	ends_on: string | null;
	access_app_id: string | null;
	synced_emails: string | null;
	synced_at: string | null;
	sync_error: string | null;
	created_at: string;
	updated_at: string;
}

export interface ApplicationRow {
	id: string;
	name: string;
	email: string;
	institution: string;
	wish_experiment_id: number | null;
	wish_text: string | null;
	reason: string;
	status: ApplicationStatus;
	experiment_id: number | null;
	consent_at: string;
	created_at: string;
	updated_at: string;
	confirmed_at: string | null;
	decided_at: string | null;
	access_emailed_at: string | null;
	resends: number;
}

/** Days an unconfirmed application is kept (its confirm link's lifetime). */
export const UNCONFIRMED_DAYS = 3;
/** Days after the course's last day that its applications are deleted. */
export const KEEP_AFTER_COURSE_DAYS = 30;
/** Days an application is kept when its experiment has no end date set (or it named none). */
export const KEEP_WITHOUT_COURSE_DAYS = 180;
/** Confirmation emails one address can be sent before it is left alone (until the application lapses). */
export const MAX_RESENDS = 3;
/** New applications accepted per hour from everyone together: a flood stops here, not in the admins' inbox. */
export const MAX_NEW_PER_HOUR = 60;

export class RemoteError extends Error {
	readonly status: number;
	readonly field?: string;
	constructor(message: string, status = 400, field?: string) {
		super(message);
		this.status = status;
		this.field = field;
	}
}

const truthy = (v: unknown) => v === true || v === 'on' || v === 'true' || v === '1' || v === 1;

export interface ApplicationInput {
	name: string;
	email: string;
	institution: string;
	wish_experiment_id: number | null;
	wish_text: string | null;
	reason: string;
}

/** Checks and tidies the public form. `offered`: the ids of experiments the form may name. */
export function checkApplication(input: Record<string, unknown>, offered: number[]): ApplicationInput {
	if (!truthy(input.consent)) throw new RemoteError('Please tick the consent box to apply.', 400, 'consent');
	const name = cleanLine(input.name, 120);
	if (!name) throw new RemoteError('Please enter your name.', 400, 'name');
	const email = cleanText(input.email, 254)?.toLowerCase() ?? '';
	if (!EMAIL_RE.test(email)) throw new RemoteError('Please enter a valid email address.', 400, 'email');
	const institution = cleanLine(input.institution, 200);
	if (!institution) throw new RemoteError('Please say where you study or work, and your course.', 400, 'institution');
	const reason = cleanText(input.reason, 1500);
	if (!reason) throw new RemoteError('Please say briefly why you would like access.', 400, 'reason');
	const raw = input.experiment;
	let wish_experiment_id: number | null = null;
	if (raw !== undefined && raw !== null && raw !== '' && raw !== 'other') {
		const n = Number(raw);
		if (!Number.isInteger(n) || !offered.includes(n)) throw new RemoteError('Please choose an experiment from the list.', 400, 'experiment');
		wish_experiment_id = n;
	}
	const wish_text = cleanLine(input.experiment_other, 200);
	return { name, email, institution, wish_experiment_id, wish_text, reason };
}

/** A Pi's public address: a lower-case DNS name with at least three labels (it lives under one of our zones). */
export function checkHostname(v: unknown): string {
	const h = String(v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
	const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
	const parts = h.split('.');
	if (h.length > 253 || parts.length < 3 || !parts.every((p) => label.test(p))) throw new RemoteError('Enter the Pi\'s address as a host name, for example remote-glasgow.amybo.org.', 400, 'hostname');
	return h;
}

/**
 * Cloudflare's free (Universal) certificate covers a zone and one level below it: remote-glasgow.amybo.org works,
 * glasgow.remote.amybo.org would not get HTTPS without an advanced certificate. Shown as a warning, not refused.
 */
export function hostnameWarning(h: string): string | null {
	return h.split('.').length > 3 ? `${h} is two levels below the domain: Cloudflare's free certificate does not cover it. Prefer one level, for example ${h.split('.')[0]}-${h.split('.')[1]}.${h.split('.').slice(2).join('.')}.` : null;
}

export function checkDate(v: unknown): string | null {
	if (v === null || v === undefined || v === '') return null;
	const s = String(v).trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw new RemoteError('Use a date like 2026-12-18.', 400, 'ends_on');
	return s;
}

/** A Cloudflare Access application id is a UUID. */
export function checkAppId(v: unknown): string | null {
	const s = String(v ?? '').trim().toLowerCase();
	if (!s) return null;
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) throw new RemoteError('The Access application id looks like 1a2b3c4d-…: copy it from the application\'s Overview (Application ID).', 400, 'access_app_id');
	return s;
}

export function checkStatus(v: unknown): ExperimentStatus {
	if (v === 'planned' || v === 'open' || v === 'closed') return v;
	throw new RemoteError('Status is planned, open or closed.', 400, 'status');
}

export const adminEmails = (env: { ADMIN_EMAILS?: string }) =>
	(env.ADMIN_EMAILS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => EMAIL_RE.test(x));

/** Whether an experiment lets its assigned people in today: open, and not past its last day (UK date). */
export function letsPeopleIn(exp: Pick<ExperimentRow, 'status' | 'ends_on'>, now = new Date()): boolean {
	if (exp.status !== 'open') return false;
	if (!exp.ends_on) return true;
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
	return today <= exp.ends_on;
}

/**
 * Who the experiment's Access policy should let in: the admins always (so the policy is never empty and the organiser can
 * always look), and the people assigned to it while it lets people in. Sorted, unique, lower case.
 */
export function allowList(exp: Pick<ExperimentRow, 'status' | 'ends_on'>, assigned: string[], admins: string[], now = new Date()): string[] {
	const people = letsPeopleIn(exp, now) ? assigned : [];
	return [...new Set([...admins, ...people].map((e) => e.trim().toLowerCase()).filter(Boolean))].sort();
}

export const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function parseList(json: string | null): string[] | null {
	if (!json) return null;
	try {
		const v = JSON.parse(json);
		return Array.isArray(v) ? v.map(String) : null;
	} catch {
		return null;
	}
}

/** The date (YYYY-MM-DD) from which an application may be deleted, for the privacy notice and the admin page. */
export function deleteFrom(app: Pick<ApplicationRow, 'status' | 'created_at'>, exp: Pick<ExperimentRow, 'ends_on'> | null): string {
	const add = (iso: string, days: number) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);
	if (app.status === 'unconfirmed') return add(app.created_at, UNCONFIRMED_DAYS);
	if (exp?.ends_on) return add(`${exp.ends_on}T00:00:00Z`, KEEP_AFTER_COURSE_DAYS + 1);
	return add(app.created_at, KEEP_WITHOUT_COURSE_DAYS);
}
