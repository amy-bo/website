// Link pages: invitations, emailed sign-in links and sessions. No passwords. Only SHA-256 hashes of tokens are stored.
import { sendEmail } from '../../eventsandeye/src/email';
import { isDev, siteUrl } from '../../eventsandeye/src/env';
import type { Ctx, Env } from './server';

export const COOKIE = 'lp_s';
const SESSION_DAYS = 60;
const SIGNIN_MINUTES = 20;
const INVITE_DAYS = 7;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export async function sha256(s: string): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
	return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, 'Z');
export const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
export const fail = (error: string, status = 400) => json({ error }, status);

export interface SessionPerson {
	id: number;
	handle: string;
	email: string;
	name: string;
	status: string;
}

export async function personFromSession(env: Env, req: Request): Promise<SessionPerson | null> {
	const raw = (req.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
	if (!raw) return null;
	return env.DB.prepare(
		`SELECT p.id, p.handle, p.email, p.name, p.status FROM lp_sessions s JOIN lp_people p ON p.id = s.person_id
		 WHERE s.hash = ? AND s.expires_at > ? AND p.status = 'active'`,
	)
		.bind(await sha256(raw), nowIso())
		.first<SessionPerson>();
}

const secureCookies = (env: Env, req: Request) => !(isDev(env) && new URL(req.url).protocol === 'http:');

export async function startSession(env: Env, req: Request, personId: number): Promise<string> {
	const token = newToken();
	await env.DB.batch([
		env.DB.prepare('INSERT INTO lp_sessions (hash, person_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), personId, isoIn(SESSION_DAYS * 864e5)),
		env.DB.prepare(`UPDATE lp_people SET status = 'active', last_sign_in = ? WHERE id = ? AND status != 'disabled'`).bind(nowIso(), personId),
		env.DB.prepare('DELETE FROM lp_sessions WHERE expires_at < ?').bind(nowIso()),
	]);
	return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureCookies(env, req) ? '; Secure' : ''}`;
}

export async function endSession(env: Env, req: Request): Promise<string> {
	const raw = (req.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
	if (raw) await env.DB.prepare('DELETE FROM lp_sessions WHERE hash = ?').bind(await sha256(raw)).run();
	return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies(env, req) ? '; Secure' : ''}`;
}

const editUrl = (env: Env, token: string) => `${siteUrl(env)}/links/edit/#t=${token}`;

function emailHtml(lines: string[], button: { href: string; label: string }): string {
	const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
	return `<div style="font-family:-apple-system,system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;line-height:1.5;color:#132010;max-width:32rem">${lines
		.map((l) => `<p>${esc(l)}</p>`)
		.join('')}<p><a href="${esc(button.href)}" style="display:inline-block;background:#175a00;color:#fff;text-decoration:none;font-weight:600;padding:.7rem 1.4rem;border-radius:999px">${esc(button.label)}</a></p><p style="color:#5d6c56;font-size:13px">Or paste this into your browser: ${esc(button.href)}</p></div>`;
}

/** Emails a single-use link. Invitations last 7 days, sign-in links 20 minutes. */
export async function sendLink(env: Env, person: { id: number; email: string; name: string; handle: string }, purpose: 'invite' | 'signin', inviter?: string) {
	const token = newToken();
	// Sign-in links: at most one a minute and five an hour per person, checked and recorded in one statement.
	const r = await env.DB.prepare(
		`INSERT INTO lp_tokens (hash, person_id, purpose, expires_at) SELECT ?1, ?2, ?3, ?4
		 WHERE ?3 = 'invite' OR (
			(SELECT COUNT(*) FROM lp_tokens WHERE person_id = ?2 AND purpose = 'signin' AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour')) < 5
			AND NOT EXISTS (SELECT 1 FROM lp_tokens WHERE person_id = ?2 AND purpose = 'signin' AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-60 seconds')))`,
	)
		.bind(await sha256(token), person.id, purpose, isoIn(purpose === 'invite' ? INVITE_DAYS * 864e5 : SIGNIN_MINUTES * 6e4))
		.run();
	if (!r.meta.changes) return;
	const href = editUrl(env, token);
	const page = person.handle === 'amybo' ? 'amy.bo/links' : `amy.bo/~${person.handle}`;
	const first = person.name.split(/\s+/)[0] || person.name;
	if (purpose === 'invite') {
		const lines = [
			`Hi ${first},`,
			`${inviter || 'AMYBO'} has invited you to make your own link page at ${page}: one address for everything you'd like to share, with a map of your links, and a diary for your AMYBO work if you volunteer.`,
			'It takes a couple of minutes, needs no password, and you can change anything at any time. This link works for 7 days.',
		];
		await sendEmail(env, { to: person.email, subject: `Your AMYBO link page, ${page}`, text: `${lines.join('\n\n')}\n\nSet it up: ${href}\n`, html: emailHtml(lines, { href, label: 'Set up my page' }) });
	} else {
		const lines = [`Hi ${first},`, `Here's your link to edit ${page}. It works once, for 20 minutes.`, "If you didn't ask for it, you can ignore this email."];
		await sendEmail(env, { to: person.email, subject: `Sign in to edit ${page}`, text: `${lines.join('\n\n')}\n\nSign in: ${href}\n`, html: emailHtml(lines, { href, label: 'Sign in' }) });
	}
}

/** Whose page a token is for, without using it up. */
export async function peek(env: Env, token: string): Promise<{ handle: string; name: string } | null> {
	if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
	return env.DB.prepare(
		`SELECT p.handle, p.name FROM lp_tokens t JOIN lp_people p ON p.id = t.person_id
		 WHERE t.hash = ? AND t.used_at IS NULL AND t.expires_at > ? AND p.status != 'disabled'`,
	)
		.bind(await sha256(token), nowIso())
		.first<{ handle: string; name: string }>();
}

/** Uses up a token and returns its person, or null if it is unknown, used or expired. */
export async function redeem(env: Env, token: string): Promise<number | null> {
	if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
	const hash = await sha256(token);
	const row = await env.DB.prepare(
		`UPDATE lp_tokens SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires_at > ?
		 AND person_id IN (SELECT id FROM lp_people WHERE status != 'disabled') RETURNING person_id`,
	)
		.bind(nowIso(), hash, nowIso())
		.first<{ person_id: number }>();
	return row?.person_id ?? null;
}

/** Same-origin JSON requests only, so another site can't act with someone's session. */
export function checkOrigin(ctx: Ctx, opts: { allowImage?: boolean } = {}): Response | null {
	const req = ctx.request;
	if (req.method === 'GET' || req.method === 'HEAD') return null;
	const origin = req.headers.get('origin');
	if (origin && origin !== new URL(req.url).origin) return fail('Cross-origin request refused', 403);
	const site = req.headers.get('sec-fetch-site');
	if (site && site !== 'same-origin' && site !== 'none') return fail('Cross-site request refused', 403);
	if (!origin && !site) return fail('Changes must come from the editor', 403);
	const type = (req.headers.get('content-type') ?? '').split(';')[0].trim();
	if (type !== 'application/json' && !(opts.allowImage && /^image\/(webp|png|jpeg|gif)$/.test(type))) return fail('Unsupported content type', 415);
	return null;
}
