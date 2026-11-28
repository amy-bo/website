// Remote access (amybo.org/remote): applications, experiments, emails, the Access allow lists and deletion.
// Routes in functions/api/remote/ (public) and functions/api/admin/remote/ and functions/admin/remote/ (behind Cloudflare
// Access, with the admin JWT check in functions/api/admin/_middleware.ts and functions/admin/_middleware.ts).
//
// Privacy: an application holds the name, email, institution and course, the experiment wished for and why. Unconfirmed
// applications are deleted after 3 days; the rest 30 days after the course they are for ends (180 days after applying when
// no end date is set). The person can withdraw at any time from a link in every email, which deletes it straight away.
import { sendEmail } from '../../eventsandeye/src/email';
import { type Env as EventsEnv, isDev, notifyEmail, orgName, privacyUrl, siteUrl } from '../../eventsandeye/src/env';
import { verifyTurnstile } from '../../eventsandeye/src/turnstile';
import { base64url, base64urlDecode, cleanLine, escapeHtml, nowIso, randomToken } from '../../eventsandeye/src/util';
import { accessApiReady, AccessSyncError, type AccessEnv, syncAccess } from './access';
import {
	adminEmails, allowList, type ApplicationRow, checkAppId, checkApplication, checkDate, checkHostname, checkStatus, type ExperimentRow,
	KEEP_AFTER_COURSE_DAYS, KEEP_WITHOUT_COURSE_DAYS, letsPeopleIn, MAX_NEW_PER_HOUR, MAX_RESENDS, parseList, RemoteError, sameList, UNCONFIRMED_DAYS,
} from './core';

export interface Env extends EventsEnv, AccessEnv {}
export type Ctx = EventContext<Env, string, { adminEmail?: string }>;

/** The Turnstile widget's data-action on the apply form. */
export const TURNSTILE_ACTION = 'amybo-remote-apply';
/** Every application is answered after at least this long, so the time taken says nothing about the address. */
const MIN_MS = 1500;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (e: RemoteError) => json({ ok: false, error: e.message, ...(e.field ? { field: e.field } : {}) }, e.status);

/** JSON errors for RemoteError, a generic 500 otherwise (details only in the log). */
export function handle(fn: (ctx: Ctx) => Promise<unknown>) {
	return async (ctx: Ctx): Promise<Response> => {
		try {
			const r = await fn(ctx);
			return r instanceof Response ? r : json(r);
		} catch (e) {
			if (e instanceof RemoteError) return fail(e);
			console.error('remote', e);
			return json({ ok: false, error: `Something went wrong. Please try again, or email ${notifyEmail(ctx.env)}.` }, 500);
		}
	};
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
	if (!(request.headers.get('content-type') || '').includes('application/json')) throw new RemoteError('Expected JSON.', 415);
	if (Number(request.headers.get('content-length')) > 20_000) throw new RemoteError('Request too large.', 413);
	const text = await request.text();
	if (text.length > 20_000) throw new RemoteError('Request too large.', 413);
	try {
		const v = JSON.parse(text);
		if (v && typeof v === 'object' && !Array.isArray(v)) return v;
	} catch {}
	throw new RemoteError('Invalid JSON.');
}

// ---------- links in emails ----------

/** confirm: the double opt-in link (3 days). withdraw: delete my application (a year: longer than any course). */
type Purpose = 'confirm' | 'withdraw';
const LIFETIME_S: Record<Purpose, number> = { confirm: UNCONFIRMED_DAYS * 86400, withdraw: 365 * 86400 };

async function hmacKey(env: Env) {
	if (!env.TOKEN_SECRET || env.TOKEN_SECRET.length < 32) throw new Error('TOKEN_SECRET is missing or too short');
	return crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
/** `<application id>.<expiry>.<HMAC(TOKEN_SECRET, remote-purpose:id:expiry)>`: nothing stored, and unusable for Events&I's links. */
export async function makeToken(env: Env, purpose: Purpose, id: string, now = Date.now()) {
	const exp = (Math.floor(now / 1000) + LIFETIME_S[purpose]).toString(36);
	const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(`remote-${purpose}:${id}:${exp}`));
	return `${id}.${exp}.${base64url(new Uint8Array(sig))}`;
}
export async function readToken(env: Env, purpose: Purpose, token: unknown, now = Date.now()): Promise<string | null> {
	if (typeof token !== 'string' || token.length > 200) return null;
	const [id, exp, mac, ...rest] = token.split('.');
	if (rest.length || !mac || !/^[A-Za-z0-9_-]{16,64}$/.test(id) || !/^[0-9a-z]{1,10}$/.test(exp)) return null;
	let sig: Uint8Array<ArrayBuffer>;
	try {
		sig = new Uint8Array(base64urlDecode(mac));
	} catch {
		return null;
	}
	const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), sig, new TextEncoder().encode(`remote-${purpose}:${id}:${exp}`));
	return ok && parseInt(exp, 36) * 1000 > now ? id : null;
}
const pageUrl = async (env: Env, purpose: Purpose, id: string) => `${siteUrl(env)}/remote/${purpose}/?t=${await makeToken(env, purpose, id)}`;

// ---------- emails ----------

function emailHtml(lines: string[], button?: { href: string; label: string }, after: string[] = []): string {
	const p = (l: string) => `<p>${escapeHtml(l)}</p>`;
	const btn = button
		? `<p><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#0069a0;color:#fff;text-decoration:none;font-weight:600;padding:.7rem 1.4rem;border-radius:999px">${escapeHtml(button.label)}</a></p><p style="color:#5d6c56;font-size:13px">Or paste this into your browser: ${escapeHtml(button.href)}</p>`
		: '';
	return `<div style="font-family:-apple-system,system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;line-height:1.5;color:#132010;max-width:34rem">${lines.map(p).join('')}${btn}${after.map((l) => `<p style="color:#5d6c56;font-size:13px">${escapeHtml(l)}</p>`).join('')}</div>`;
}

const footer = (env: Env, withdraw: string) => [
	`Changed your mind? Withdraw your application, which deletes it: ${withdraw}`,
	`How we use your details: ${privacyUrl(env)}`,
	env.ORG_FOOTER || '',
].filter(Boolean);

const first = (name: string) => name.split(/\s+/)[0] || name;

async function sendConfirm(env: Env, app: Pick<ApplicationRow, 'id' | 'name' | 'email'>) {
	const href = await pageUrl(env, 'confirm', app.id);
	const lines = [`Hi ${first(app.name)},`, `Thanks for applying for remote access to an ${orgName(env)} electroPioreactor. Please confirm your email address so we can consider your application. The link works for ${UNCONFIRMED_DAYS} days.`, "If you didn't apply, ignore this email: the application is deleted unless it is confirmed."];
	const after = [`How we use your details: ${privacyUrl(env)}`, env.ORG_FOOTER || ''].filter(Boolean);
	await sendEmail(env, { to: app.email, subject: `Confirm your ${orgName(env)} remote access application`, text: `${lines.join('\n\n')}\n\nConfirm: ${href}\n\n${after.join('\n')}\n`, html: emailHtml(lines, { href, label: 'Confirm my application' }, after) });
}

async function sendAccess(env: Env, app: Pick<ApplicationRow, 'id' | 'name' | 'email'>, exp: Pick<ExperimentRow, 'name' | 'hostname' | 'ends_on'>) {
	const href = `https://${exp.hostname}/`;
	const lines = [
		`Hi ${first(app.name)},`,
		`You now have access to the ${exp.name} electroPioreactor${exp.ends_on ? ` until the end of ${exp.ends_on}` : ''}.`,
		`Open ${href} and sign in with this email address (${app.email}). Cloudflare, which guards the bioreactor for us, then emails you a one-time code: type it in, and you are in. Only the people assigned to this experiment can sign in.`,
		'It controls real hardware with live cultures: please change only what your experiment needs, and tell us straight away if something looks wrong.',
	];
	const after = footer(env, await pageUrl(env, 'withdraw', app.id));
	await sendEmail(env, { to: app.email, subject: `Your remote access: ${exp.name}`, text: `${lines.join('\n\n')}\n\nOpen the bioreactor: ${href}\n\n${after.join('\n')}\n`, html: emailHtml(lines, { href, label: 'Open the bioreactor' }, after) });
}

async function notifyAdmins(env: Env, app: ApplicationRow, wish: string) {
	const lines = [`${app.name} (${app.institution}) has applied for remote access${wish ? `, for ${wish}` : ''}.`, `Why: ${app.reason}`, `Assign or reject it on the admin page: ${siteUrl(env)}/admin/remote/`];
	await sendEmail(env, { to: notifyEmail(env), subject: `Remote access application: ${app.name}`, text: `${lines.join('\n\n')}\n`, html: emailHtml(lines) });
}

// ---------- reads ----------

export const getExperiment = (env: Env, id: number) => env.DB.prepare('SELECT * FROM remote_experiments WHERE id = ?').bind(id).first<ExperimentRow>();
const getApplication = (env: Env, id: string) => env.DB.prepare('SELECT * FROM remote_applications WHERE id = ?').bind(id).first<ApplicationRow>();

/** The experiments the form offers: marked "offered" and not closed. */
export async function offeredExperiments(env: Env) {
	const r = await env.DB.prepare(`SELECT id, name, status, ends_on FROM remote_experiments WHERE offered = 1 AND status != 'closed' ORDER BY name`).all<Pick<ExperimentRow, 'id' | 'name' | 'status' | 'ends_on'>>();
	return r.results;
}

async function assignedEmails(env: Env, expId: number) {
	const r = await env.DB.prepare(`SELECT email FROM remote_applications WHERE experiment_id = ? AND status = 'approved'`).bind(expId).all<{ email: string }>();
	return r.results.map((x) => x.email);
}

/** Who the experiment's Access policy should let in now. */
export async function wantedList(env: Env, exp: ExperimentRow, now = new Date()) {
	return allowList(exp, await assignedEmails(env, exp.id), adminEmails(env), now);
}

export interface AccessState {
	/** api: written through the Cloudflare API; manual: paste `emails` into the policy by hand. */
	mode: 'api' | 'manual';
	emails: string[];
	inSync: boolean;
	error: string | null;
	others?: string[];
}

/**
 * Brings the experiment's Access policy in line with who should be let in. With the API configured and the experiment's
 * application id set, writes it; otherwise reports the list to paste. Failures are recorded on the experiment, not thrown.
 */
export async function refreshAccess(env: Env, expId: number, now = new Date()): Promise<AccessState | null> {
	const exp = await getExperiment(env, expId);
	if (!exp) return null;
	const emails = await wantedList(env, exp, now);
	if (!accessApiReady(env) || !exp.access_app_id) {
		const synced = parseList(exp.synced_emails);
		return { mode: 'manual', emails, inSync: !!synced && sameList(synced, emails), error: null };
	}
	try {
		const r = await syncAccess(env, exp.access_app_id, exp.hostname, emails);
		await env.DB.prepare('UPDATE remote_experiments SET synced_emails = ?, synced_at = ?, sync_error = NULL WHERE id = ?').bind(JSON.stringify(r.emails), nowIso(), exp.id).run();
		return { mode: 'api', emails, inSync: true, error: null, others: r.others };
	} catch (e) {
		const msg = e instanceof AccessSyncError ? e.message : 'Could not reach the Cloudflare API.';
		if (!(e instanceof AccessSyncError)) console.error('remote access sync', e);
		await env.DB.prepare('UPDATE remote_experiments SET sync_error = ? WHERE id = ?').bind(msg, exp.id).run();
		return { mode: 'api', emails, inSync: false, error: msg };
	}
}

// ---------- public API ----------

export const getExperiments = handle(async ({ env }) => ({ ok: true, experiments: (await offeredExperiments(env)).map((e) => ({ id: e.id, name: e.name, status: e.status })) }));

export const postApply = handle(async ({ env, request }) => {
	const started = Date.now();
	try {
		const body = await readBody(request);
		// Honeypot: people never see the "website" field. Pretend success, in the usual time, so bots learn nothing.
		if (typeof body.website === 'string' && body.website.trim() !== '') return { ok: true };
		const human = await verifyTurnstile(env, body['cf-turnstile-response'], request.headers.get('cf-connecting-ip'), new URL(request.url).hostname, TURNSTILE_ACTION);
		if (!human) throw new RemoteError('The spam check failed. Please reload the page and try again.', 403);
		const offered = (await offeredExperiments(env)).map((e) => e.id);
		const input = checkApplication(body, offered);
		const now = nowIso();
		const existing = await env.DB.prepare('SELECT * FROM remote_applications WHERE email = ?').bind(input.email).first<ApplicationRow>();
		// The same answer whatever is on file, so the form cannot tell anyone whether an address has applied.
		if (existing && existing.status !== 'unconfirmed') return { ok: true };
		if (existing) {
			// An unconfirmed application is replaced by the new one, a few times: each is an email to an unverified address.
			if (existing.resends >= MAX_RESENDS) return { ok: true };
			await env.DB.prepare(`UPDATE remote_applications SET name = ?, institution = ?, wish_experiment_id = ?, wish_text = ?, reason = ?, consent_at = ?, updated_at = ?, resends = resends + 1 WHERE id = ? AND status = 'unconfirmed'`)
				.bind(input.name, input.institution, input.wish_experiment_id, input.wish_text, input.reason, now, now, existing.id).run();
			await sendConfirm(env, { id: existing.id, name: input.name, email: input.email });
			return { ok: true };
		}
		const hourAgo = new Date(Date.now() - 3600_000).toISOString();
		const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM remote_applications WHERE created_at > ?').bind(hourAgo).first<{ n: number }>();
		if ((recent?.n ?? 0) >= MAX_NEW_PER_HOUR) throw new RemoteError('We are getting a lot of applications just now. Please try again in an hour.', 429);
		const id = randomToken(16);
		try {
			await env.DB.prepare(`INSERT INTO remote_applications (id, name, email, institution, wish_experiment_id, wish_text, reason, status, consent_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'unconfirmed',?,?,?)`)
				.bind(id, input.name, input.email, input.institution, input.wish_experiment_id, input.wish_text, input.reason, now, now, now).run();
		} catch (e) {
			// The same address submitted twice at once: the other submission's email is on its way.
			if (/UNIQUE/i.test(String(e))) return { ok: true };
			throw e;
		}
		try {
			await sendConfirm(env, { id, name: input.name, email: input.email });
		} catch (e) {
			// Nobody can confirm an application whose email never went: don't keep their details.
			await env.DB.prepare(`DELETE FROM remote_applications WHERE id = ? AND status = 'unconfirmed'`).bind(id).run();
			throw e;
		}
		return { ok: true };
	} finally {
		const floor = isDev(env) && env.REGISTER_MIN_MS !== undefined && env.REGISTER_MIN_MS.trim() !== '' ? Number(env.REGISTER_MIN_MS) : MIN_MS;
		const left = started + floor - Date.now();
		if (left > 0) await new Promise((r) => setTimeout(r, left));
	}
});

/** POST only (behind a button on the page), so link scanners that open emailed links cannot confirm. */
export const postConfirm = handle(async ({ env, request }) => {
	const { t } = await readBody(request);
	const id = await readToken(env, 'confirm', t);
	const app = id ? await getApplication(env, id) : null;
	if (!app) throw new RemoteError('This link is not valid any more. Please apply again.', 404);
	if (app.status !== 'unconfirmed') return { ok: true, already: true };
	const now = nowIso();
	await env.DB.prepare(`UPDATE remote_applications SET status = 'pending', confirmed_at = ?, updated_at = ? WHERE id = ? AND status = 'unconfirmed'`).bind(now, now, app.id).run();
	const wish = app.wish_experiment_id ? (await getExperiment(env, app.wish_experiment_id))?.name ?? '' : app.wish_text ?? '';
	try {
		await notifyAdmins(env, { ...app, status: 'pending' }, wish);
	} catch (e) {
		// The application is confirmed and on the admin page either way.
		console.error('remote: admin notification failed', e);
	}
	return { ok: true, already: false };
});

/** Deletes the application at once, and takes the person off the Pi's allow list. */
export const postWithdraw = handle(async ({ env, request }) => {
	const { t } = await readBody(request);
	const id = (await readToken(env, 'withdraw', t)) ?? (await readToken(env, 'confirm', t));
	const app = id ? await getApplication(env, id) : null;
	if (!app) return { ok: true, already: true };
	await env.DB.prepare('DELETE FROM remote_applications WHERE id = ?').bind(app.id).run();
	if (app.experiment_id) {
		const access = await refreshAccess(env, app.experiment_id);
		if (access && !access.inSync) {
			// Cloudflare still lets them in until the policy is updated by hand: tell the organisers now.
			const lines = [`${app.name} has withdrawn their remote access application, which has been deleted.`, `Their address is still in the Access policy until you update it: open ${siteUrl(env)}/admin/remote/ and follow the steps for that experiment.`];
			await sendEmail(env, { to: notifyEmail(env), subject: 'Remote access withdrawn: update the Access policy', text: `${lines.join('\n\n')}\n`, html: emailHtml(lines) }).catch((e) => console.error('remote: withdraw notification failed', e));
		}
	}
	return { ok: true, already: false };
});

// ---------- admin API ----------

const num = (v: unknown, field: string) => {
	const n = Number(v);
	if (!Number.isInteger(n) || n <= 0) throw new RemoteError(`Missing ${field}.`, 400, field);
	return n;
};

async function emailAccessLinks(env: Env, exp: ExperimentRow) {
	const r = await env.DB.prepare(`SELECT * FROM remote_applications WHERE experiment_id = ? AND status = 'approved' AND access_emailed_at IS NULL`).bind(exp.id).all<ApplicationRow>();
	let sent = 0;
	for (const app of r.results) {
		await sendAccess(env, app, exp);
		await env.DB.prepare('UPDATE remote_applications SET access_emailed_at = ? WHERE id = ?').bind(nowIso(), app.id).run();
		sent++;
	}
	return sent;
}

export const postAdmin = handle(async ({ env, request }) => {
	const b = await readBody(request);
	const now = nowIso();
	switch (b.action) {
		case 'experiment.save': {
			const name = cleanLine(b.name, 80);
			if (!name) throw new RemoteError('Give the experiment a name.', 400, 'name');
			const hostname = checkHostname(b.hostname);
			const status = checkStatus(b.status);
			const ends_on = checkDate(b.ends_on);
			const appId = checkAppId(b.access_app_id);
			const offered = b.offered === false || b.offered === 'false' || b.offered === 0 ? 0 : 1;
			const clash = await env.DB.prepare('SELECT id FROM remote_experiments WHERE hostname = ? AND id != ?').bind(hostname, Number(b.id) || 0).first<{ id: number }>();
			if (clash) throw new RemoteError(`Another experiment already uses ${hostname}.`, 409, 'hostname');
			let id: number;
			if (b.id) {
				id = num(b.id, 'id');
				const before = await getExperiment(env, id);
				if (!before) throw new RemoteError('No such experiment.', 404);
				// A new address or application starts unsynced: what was written belonged to the old one.
				const moved = before.hostname !== hostname || before.access_app_id !== appId;
				await env.DB.prepare(`UPDATE remote_experiments SET name = ?, hostname = ?, status = ?, offered = ?, ends_on = ?, access_app_id = ?, updated_at = ?${moved ? ', synced_emails = NULL, synced_at = NULL, sync_error = NULL' : ''} WHERE id = ?`)
					.bind(name, hostname, status, offered, ends_on, appId, now, id).run();
			} else {
				const r = await env.DB.prepare(`INSERT INTO remote_experiments (name, hostname, status, offered, ends_on, access_app_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id`)
					.bind(name, hostname, status, offered, ends_on, appId, now, now).first<{ id: number }>();
				id = r!.id;
			}
			return { ok: true, id, access: await refreshAccess(env, id) };
		}
		case 'experiment.sync':
			return { ok: true, access: await refreshAccess(env, num(b.id, 'id')) };
		case 'experiment.mark_synced': {
			// Manual mode: the admin has pasted the list shown into the policy.
			const exp = await getExperiment(env, num(b.id, 'id'));
			if (!exp) throw new RemoteError('No such experiment.', 404);
			const emails = await wantedList(env, exp);
			await env.DB.prepare('UPDATE remote_experiments SET synced_emails = ?, synced_at = ?, sync_error = NULL WHERE id = ?').bind(JSON.stringify(emails), now, exp.id).run();
			return { ok: true };
		}
		case 'experiment.email_links': {
			const exp = await getExperiment(env, num(b.id, 'id'));
			if (!exp) throw new RemoteError('No such experiment.', 404);
			if (!letsPeopleIn(exp)) throw new RemoteError('Open the experiment first (status open, and not past its last day).', 409);
			const synced = parseList(exp.synced_emails);
			if (!synced || !sameList(synced, await wantedList(env, exp))) throw new RemoteError('The Access policy is not up to date yet: sync it (or paste the list and mark it done) first, so the links work.', 409);
			return { ok: true, sent: await emailAccessLinks(env, exp) };
		}
		case 'application.assign': {
			const app = await getApplication(env, String(b.id ?? ''));
			if (!app) throw new RemoteError('No such application.', 404);
			if (app.status === 'unconfirmed') throw new RemoteError('That person has not confirmed their email address yet.', 409);
			const exp = await getExperiment(env, num(b.experiment_id, 'experiment_id'));
			if (!exp) throw new RemoteError('No such experiment.', 404);
			const moved = app.experiment_id !== exp.id;
			await env.DB.prepare(`UPDATE remote_applications SET status = 'approved', experiment_id = ?, decided_at = ?, updated_at = ?${moved ? ', access_emailed_at = NULL' : ''} WHERE id = ?`).bind(exp.id, now, now, app.id).run();
			if (moved && app.experiment_id) await refreshAccess(env, app.experiment_id);
			const access = await refreshAccess(env, exp.id);
			// Emailed straight away only when Cloudflare has the new list; otherwise from "Email access links" once it does.
			const emailed = access?.mode === 'api' && access.inSync && letsPeopleIn(exp) ? await emailAccessLinks(env, exp) : 0;
			return { ok: true, access, emailed };
		}
		case 'application.unassign':
		case 'application.reject':
		case 'application.delete': {
			const app = await getApplication(env, String(b.id ?? ''));
			if (!app) throw new RemoteError('No such application.', 404);
			if (b.action === 'application.delete') await env.DB.prepare('DELETE FROM remote_applications WHERE id = ?').bind(app.id).run();
			else
				await env.DB.prepare(`UPDATE remote_applications SET status = ?, experiment_id = NULL, access_emailed_at = NULL, decided_at = ?, updated_at = ? WHERE id = ?`)
					.bind(b.action === 'application.reject' ? 'rejected' : 'pending', now, now, app.id).run();
			const access = app.experiment_id ? await refreshAccess(env, app.experiment_id) : null;
			return { ok: true, access };
		}
		default:
			throw new RemoteError('Unknown action.');
	}
});

// ---------- deletion (cron) ----------

/**
 * Deletes unconfirmed applications after 3 days and the rest 30 days after their course ends (180 days after applying
 * without an end date), then brings every experiment's Access policy in line (the people of a course that has ended are
 * taken off). Run by the cron Worker.
 */
export async function purge(env: Env, now = new Date()) {
	const iso = (days: number) => new Date(now.getTime() - days * 864e5).toISOString();
	const day = (days: number) => iso(days).slice(0, 10);
	const has = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'remote_applications'`).first();
	if (!has) return { unconfirmed: 0, ended: 0, synced: 0, failed: 0 };
	const a = await env.DB.prepare(`DELETE FROM remote_applications WHERE status = 'unconfirmed' AND created_at < ?`).bind(iso(UNCONFIRMED_DAYS)).run();
	const b = await env.DB.prepare(
		`DELETE FROM remote_applications WHERE status != 'unconfirmed' AND id IN (
			SELECT a.id FROM remote_applications a LEFT JOIN remote_experiments e ON e.id = COALESCE(a.experiment_id, a.wish_experiment_id)
			WHERE (e.ends_on IS NOT NULL AND e.ends_on < ?) OR (e.ends_on IS NULL AND a.created_at < ?))`,
	).bind(day(KEEP_AFTER_COURSE_DAYS), iso(KEEP_WITHOUT_COURSE_DAYS)).run();
	let synced = 0, failed = 0;
	const exps = (await env.DB.prepare('SELECT * FROM remote_experiments').all<ExperimentRow>()).results;
	for (const exp of exps) {
		const want = await wantedList(env, exp, now);
		const have = parseList(exp.synced_emails);
		if (have && sameList(have, want)) continue;
		if (!accessApiReady(env) || !exp.access_app_id) {
			if (have) console.warn(`remote: the Access policy for ${exp.hostname} is out of date; the admin page shows the list to paste.`);
			continue;
		}
		const r = await refreshAccess(env, exp.id, now);
		if (r?.inSync) synced++;
		else failed++;
	}
	return { unconfirmed: a.meta.changes ?? 0, ended: b.meta.changes ?? 0, synced, failed };
}
