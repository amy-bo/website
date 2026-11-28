// Remote access: writing an experiment's allow list into its Cloudflare Access policy, through the Cloudflare API.
//
// Needs two Pages settings, both kept as secrets: the CF_ACCESS_API_TOKEN (an API token with only Account › Access: Apps and Policies › Edit) and
// CF_ACCOUNT_ID. Without them, or without the experiment's Access application id, nothing is sent and the admin page
// shows the list to paste into the policy by hand.
//
// Only one policy is ever changed: the Allow policy of the experiment's own Access application (the one named
// "AMYBO remote…", or the application's only Allow policy). Only its email rules are replaced; every other setting and
// rule is sent back as Cloudflare returned it. It refuses to touch the admin pages' application, an application that does
// not protect the experiment's hostname, and a reusable policy that other applications also use.

const API = 'https://api.cloudflare.com/client/v4';

export interface AccessEnv {
	CF_ACCESS_API_TOKEN?: string;
	CF_ACCOUNT_ID?: string;
	/** The admin pages' Access application: never written to. */
	ACCESS_AUD?: string;
}

export const accessApiReady = (env: AccessEnv) => !!(env.CF_ACCESS_API_TOKEN?.trim() && /^[0-9a-f]{32}$/i.test(env.CF_ACCOUNT_ID?.trim() ?? ''));

type Rule = Record<string, unknown>;
interface Policy {
	id: string;
	name?: string;
	decision?: string;
	include?: Rule[];
	reusable?: boolean;
	app_count?: number;
	[k: string]: unknown;
}
interface App {
	id: string;
	aud?: string;
	domain?: string;
	self_hosted_domains?: string[];
	destinations?: { type?: string; uri?: string }[];
	policies?: Policy[];
}

export class AccessSyncError extends Error {}

async function cf<T>(env: AccessEnv, method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${API}/accounts/${env.CF_ACCOUNT_ID!.trim()}${path}`, {
		method,
		headers: { authorization: `Bearer ${env.CF_ACCESS_API_TOKEN!.trim()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	let data: { success?: boolean; result?: T; errors?: { code?: number; message?: string }[] } = {};
	try {
		data = await res.json();
	} catch {}
	if (!res.ok || data.success === false || data.result === undefined) {
		const why = (data.errors ?? []).map((e) => `${e.message ?? ''}${e.code ? ` (${e.code})` : ''}`).filter(Boolean).join('; ');
		const hint = res.status === 401 || res.status === 403 ? ' Check that CF_ACCESS_API_TOKEN has Access: Apps and Policies Edit for this account, and CF_ACCOUNT_ID.' : res.status === 404 ? ' Check the Access application id.' : '';
		throw new AccessSyncError(`Cloudflare API ${method} ${path.replace(/\/[0-9a-f-]{20,}/g, '/…')} answered ${res.status}${why ? `: ${why}` : ''}.${hint}`);
	}
	return data.result;
}

/** The host names an Access application protects (its domain, self-hosted domains and destinations), lower case. */
export function appHosts(app: App): string[] {
	const uris = [app.domain, ...(app.self_hosted_domains ?? []), ...(app.destinations ?? []).filter((d) => !d.type || d.type === 'public').map((d) => d.uri)];
	return [...new Set(uris.filter((u): u is string => !!u).map((u) => u.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/:]/)[0]))];
}

/** The experiment's Allow policy: the one named "AMYBO remote…", else the application's only Allow policy. */
export function choosePolicy(policies: Policy[]): Policy {
	const allow = policies.filter((p) => (p.decision ?? 'allow') === 'allow');
	const named = allow.filter((p) => /^amybo remote/i.test(p.name ?? ''));
	if (named.length === 1) return named[0];
	if (named.length > 1) throw new AccessSyncError('The Access application has more than one policy named "AMYBO remote…": keep one.');
	if (allow.length === 1) return allow[0];
	throw new AccessSyncError(allow.length ? 'The Access application has several Allow policies: name the one for this experiment "AMYBO remote".' : 'The Access application has no Allow policy: add one called "AMYBO remote".');
}

const isEmailRule = (r: Rule) => Object.keys(r).length === 1 && 'email' in r;
export const emailsOf = (rules: Rule[] | undefined) =>
	(rules ?? []).filter(isEmailRule).map((r) => String((r.email as { email?: unknown })?.email ?? '').toLowerCase()).filter(Boolean).sort();
/** Rules other than single emails (an email domain, everyone, a group…): kept, but reported, since they let others in too. */
export const otherRules = (rules: Rule[] | undefined) => (rules ?? []).filter((r) => !isEmailRule(r)).map((r) => Object.keys(r).join('+'));

/** Fields Cloudflare returns but does not take back. */
const READ_ONLY = new Set(['id', 'uid', 'created_at', 'updated_at', 'app_count', 'reusable', 'apps', 'app_id']);

/** Replaces the policy's email rules with `emails`, keeping everything else. */
export function policyBody(policy: Policy, emails: string[]): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(policy)) if (!READ_ONLY.has(k) && v !== null && v !== undefined) body[k] = v;
	body.include = [...(policy.include ?? []).filter((r) => !isEmailRule(r)), ...emails.map((email) => ({ email: { email } }))];
	return body;
}

export interface SyncResult {
	emails: string[];
	/** Non-email include rules the policy also has (they let other people in, so the admin page says so). */
	others: string[];
	policyName: string;
}

/**
 * Writes `emails` into the experiment's Access policy and reads back what Cloudflare stored. Throws AccessSyncError with a
 * message for the admin page; the caller records it.
 */
export async function syncAccess(env: AccessEnv, appId: string, hostname: string, emails: string[]): Promise<SyncResult> {
	if (!accessApiReady(env)) throw new AccessSyncError('CF_ACCESS_API_TOKEN and CF_ACCOUNT_ID are not set: paste the list into the policy by hand.');
	if (!emails.length) throw new AccessSyncError('An Access policy needs at least one email: set ADMIN_EMAILS.');
	const app = await cf<App>(env, 'GET', `/access/apps/${encodeURIComponent(appId)}`);
	if (env.ACCESS_AUD && app.aud && app.aud === env.ACCESS_AUD) throw new AccessSyncError('That application id is the admin pages\' Access application. Use the application made for this experiment\'s Pi.');
	const hosts = appHosts(app);
	if (!hosts.includes(hostname.toLowerCase())) throw new AccessSyncError(`That Access application protects ${hosts.join(', ') || 'no host'}, not ${hostname}.`);
	const chosen = choosePolicy(app.policies ?? []);
	// The application's list may be a summary: read the policy itself, from wherever it lives.
	// true: a reusable policy; false: one scoped to this application (older); null: Cloudflare did not say.
	const reusable = typeof chosen.reusable === 'boolean' ? chosen.reusable : null;
	let policy: Policy;
	let path: string;
	if (reusable === false) {
		path = `/access/apps/${encodeURIComponent(appId)}/policies/${encodeURIComponent(chosen.id)}`;
		policy = await cf<Policy>(env, 'GET', path);
	} else {
		path = `/access/policies/${encodeURIComponent(chosen.id)}`;
		try {
			policy = await cf<Policy>(env, 'GET', path);
		} catch (e) {
			if (reusable === true) throw e;
			// Not a reusable policy after all: an application-scoped (legacy) one.
			path = `/access/apps/${encodeURIComponent(appId)}/policies/${encodeURIComponent(chosen.id)}`;
			policy = await cf<Policy>(env, 'GET', path);
		}
	}
	if (path.startsWith('/access/policies/') && Number(policy.app_count ?? 1) > 1) throw new AccessSyncError(`The policy "${policy.name ?? chosen.id}" is used by ${policy.app_count} applications: give this experiment's application its own policy.`);
	const saved = await cf<Policy>(env, 'PUT', path, policyBody(policy, emails));
	const stored = emailsOf(saved.include);
	const want = [...emails].sort();
	if (stored.length !== want.length || stored.some((x, i) => x !== want[i])) throw new AccessSyncError('Cloudflare saved a different list from the one sent: check the policy in the dashboard.');
	return { emails: stored, others: otherRules(saved.include), policyName: String(saved.name ?? policy.name ?? '') };
}
