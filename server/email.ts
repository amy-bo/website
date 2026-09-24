import { type Env, emailFrom, isDev, notifyEmail } from './env';
import { nowIso } from './util';

export interface OutgoingEmail {
	to: string;
	subject: string;
	text: string;
	html: string;
}

const RESEND_URL = 'https://api.resend.com';

/**
 * Sends via Resend when RESEND_API_KEY is set. Without it, only DEV_MODE is allowed: the email is written to
 * the dev_outbox table and the console. On the live site a missing key is an error, never a silent skip.
 * Returns the provider message id (or 'dev:<n>').
 */
export async function sendEmail(env: Env, email: OutgoingEmail): Promise<string> {
	const [id] = await sendBatch(env, [email]);
	return id;
}

export async function sendBatch(env: Env, emails: OutgoingEmail[]): Promise<string[]> {
	if (!emails.length) return [];
	if (!env.RESEND_API_KEY) {
		if (!isDev(env)) throw new Error('RESEND_API_KEY is not set; refusing to drop email on the live site');
		const ids: string[] = [];
		for (const e of emails) {
			const r = await env.DB.prepare('INSERT INTO dev_outbox (to_addr, subject, text_body, html_body, created_at) VALUES (?,?,?,?,?)')
				.bind(e.to, e.subject, e.text, e.html, nowIso())
				.run();
			console.log(`\n[dev email] To: ${e.to}\nSubject: ${e.subject}\n\n${e.text}\n[/dev email]\n`);
			ids.push(`dev:${r.meta.last_row_id}`);
		}
		return ids;
	}
	const ids: string[] = [];
	// Resend's batch endpoint takes up to 100 emails per call; each email goes to one person (no shared To/CC).
	for (let i = 0; i < emails.length; i += 100) {
		const chunk = emails.slice(i, i + 100).map((e) => ({
			from: emailFrom(env),
			to: [e.to],
			reply_to: notifyEmail(env),
			subject: e.subject,
			text: e.text,
			html: e.html,
		}));
		const res = await fetch(`${RESEND_URL}/emails/batch`, {
			method: 'POST',
			headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
			body: JSON.stringify(chunk),
		});
		if (!res.ok) throw new Error(`Resend error ${res.status}: ${(await res.text()).slice(0, 300)}`);
		const body = (await res.json()) as { data?: { id: string }[] };
		for (const d of body.data ?? []) ids.push(d.id);
	}
	return ids;
}
