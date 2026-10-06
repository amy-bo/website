// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { type Env, siteUrl } from './env';
import { sendEmail } from './email';
import { lowerLabel } from './labels';
import { checkSuggestion } from './moderation';
import { brand, getEvent, getRegistration, getSessions, UserError } from './rsvp';
import { notification, type RegistrationRow, type SessionRow } from './templates';
import { cleanText, nowIso, randomToken } from './util';

/**
 * Ranked polls ("what shall we do on Saturday?"). Each voter puts every option in order and draws a line: options
 * above it they would go to, options below it they would not (they'd rather do their own thing). Voters can add an
 * option of their own; it appears to everyone once the automatic check (or an organiser) approves it.
 *
 * Counting: with N options, a voter's first choice scores N points, the next N-1, and so on down to the line; options
 * below the line, or not yet ranked by them, score nothing. Results are ordered by points, and show how many would go
 * to each option and who (first names, unless a voter chose not to be named).
 */

export interface PollRow { id: string; event_id: string; session_id: string | null; question: string; closes_at: string; created_at: string }
export interface OptionRow {
	id: string; poll_id: string; label: string; detail: string | null; url: string | null; status: 'approved' | 'review' | 'removed';
	suggested_by: string | null; check_note: string | null; sort: number; created_at: string;
}
interface VoteRow { poll_id: string; registration_id: string; ranking: string; above_line: number; show_name: number; updated_at: string }

/** How many options one person may suggest to a poll (removed ones count too, so a rejected idea can't be retried endlessly). */
export const MAX_SUGGESTIONS = 3;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
export const pollOpen = (p: PollRow, now = Date.now()) => now < Date.parse(p.closes_at);

export async function getPolls(env: Env, eventId: string): Promise<PollRow[]> {
	return (await env.DB.prepare('SELECT * FROM polls WHERE event_id = ? ORDER BY created_at').bind(eventId).all<PollRow>()).results;
}
async function getPoll(env: Env, id: string): Promise<PollRow> {
	const p = await env.DB.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first<PollRow>();
	if (!p) throw new UserError('Unknown poll.', 404);
	return p;
}
async function getOptions(env: Env, pollId: string): Promise<OptionRow[]> {
	return (await env.DB.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort, created_at').bind(pollId).all<OptionRow>()).results;
}
async function getVotes(env: Env, pollId: string): Promise<VoteRow[]> {
	return (await env.DB.prepare('SELECT * FROM poll_votes WHERE poll_id = ?').bind(pollId).all<VoteRow>()).results;
}

/** Who may vote: confirmed registrants signed up to the poll's session (or everyone confirmed, for a poll without one). */
export function canVote(p: PollRow, reg: Pick<RegistrationRow, 'status' | 'attendance' | 'optins'>): boolean {
	if (reg.status !== 'confirmed') return false;
	if (!p.session_id) return true;
	return reg.attendance === 'in_person' && (reg.optins ?? '').split(',').includes(p.session_id);
}

export interface ResultLine { id: string; label: string; detail: string | null; url: string | null; points: number; going: number; not_going: number; names: string[]; hidden: number }

/** The tally, counting only the current ballots of people who may still vote, and only approved options. */
export function tally(p: PollRow, options: OptionRow[], votes: VoteRow[], regs: Map<string, RegistrationRow>, opts: { allNames?: boolean } = {}) {
	const live = options.filter((o) => o.status === 'approved');
	const n = live.length;
	const lines = new Map<string, ResultLine>(live.map((o) => [o.id, { id: o.id, label: o.label, detail: o.detail, url: o.url, points: 0, going: 0, not_going: 0, names: [], hidden: 0 }]));
	let voters = 0;
	for (const v of votes) {
		const reg = regs.get(v.registration_id);
		if (!reg || !canVote(p, reg)) continue;
		voters++;
		const ranking = (JSON.parse(v.ranking) as string[]);
		ranking.forEach((id, i) => {
			const line = lines.get(id);
			if (!line) return;
			if (i < v.above_line) {
				// Position among the approved options this person ranked, so a removed option above it costs nothing.
				const pos = ranking.slice(0, i).filter((x) => lines.has(x)).length;
				line.points += n - pos;
				line.going++;
				if (v.show_name || opts.allNames) line.names.push(firstName(reg.name));
				else line.hidden++;
			} else line.not_going++;
		});
	}
	const results = [...lines.values()].sort((a, b) => b.points - a.points || b.going - a.going || a.label.localeCompare(b.label));
	return { voters, results };
}

async function regsFor(env: Env, eventId: string) {
	const rows = (await env.DB.prepare('SELECT * FROM registrations WHERE event_id = ?').bind(eventId).all<RegistrationRow>()).results;
	return new Map(rows.map((r) => [r.id, r]));
}

/** What a registrant sees: each poll of their event, whether they can vote, the options, their ballot and the tally. */
export async function pollView(env: Env, regId: string) {
	const reg = await getRegistration(env, regId);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	if (reg.status !== 'confirmed') throw new UserError('Please confirm your email address first, using the link in your registration email.', 403);
	const sessions = await getSessions(env, reg.event_id);
	const polls = await getPolls(env, reg.event_id);
	const regs = polls.length ? await regsFor(env, reg.event_id) : new Map();
	const out = [];
	for (const p of polls) {
		const options = await getOptions(env, p.id);
		const votes = await getVotes(env, p.id);
		const mine = votes.find((v) => v.registration_id === reg.id);
		const eligible = canVote(p, reg);
		const session = p.session_id ? sessions.find((s) => s.id === p.session_id) : undefined;
		out.push({
			id: p.id, question: p.question, closes_at: p.closes_at, open: pollOpen(p), eligible,
			session: session ? { id: session.id, label: session.label } : null,
			// Approved options for everyone; a voter's own suggestions too while they wait for review.
			options: options.filter((o) => o.status === 'approved' || (o.status === 'review' && o.suggested_by === reg.id))
				.map((o) => ({ id: o.id, label: o.label, detail: o.detail, url: o.url, mine: o.suggested_by === reg.id, in_review: o.status === 'review' })),
			suggestions_left: Math.max(0, MAX_SUGGESTIONS - options.filter((o) => o.suggested_by === reg.id).length),
			ballot: mine ? { ranking: JSON.parse(mine.ranking) as string[], above_line: mine.above_line, show_name: !!mine.show_name, updated_at: mine.updated_at } : null,
			...(eligible ? tally(p, options, votes, regs) : { voters: 0, results: [] }),
		});
	}
	return { ok: true as const, polls: out };
}

async function ballotContext(env: Env, regId: string, pollId: unknown) {
	const reg = await getRegistration(env, regId);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	const p = await getPoll(env, String(pollId ?? ''));
	if (p.event_id !== reg.event_id) throw new UserError('Unknown poll.', 404);
	if (!canVote(p, reg)) {
		const s = p.session_id ? (await getSessions(env, p.event_id)).find((x) => x.id === p.session_id) : undefined;
		throw new UserError(reg.status !== 'confirmed' ? 'Please confirm your email address first, using the link in your registration email.'
			: `Only people signed up for ${s ? lowerLabel(s.label) : 'this'} can vote. Tick it in your registration above, save, then vote.`, 403);
	}
	if (!pollOpen(p)) throw new UserError('This poll has closed.', 409);
	return { reg, p };
}

/** Saves a ballot. Options not (or no longer) on offer to this person are dropped; the line is clamped to the list. */
export async function vote(env: Env, regId: string, input: Record<string, unknown>) {
	const { reg, p } = await ballotContext(env, regId, input.poll);
	const options = await getOptions(env, p.id);
	const allowed = new Set(options.filter((o) => o.status === 'approved' || (o.status === 'review' && o.suggested_by === reg.id)).map((o) => o.id));
	const asked = Array.isArray(input.ranking) ? input.ranking.map(String) : [];
	const ranking = [...new Set(asked)].filter((id) => allowed.has(id));
	if (!ranking.length) throw new UserError('Please put the options in order.');
	const line = Number(input.above_line);
	if (!Number.isInteger(line)) throw new UserError('Please place the line.');
	const above = Math.max(0, Math.min(ranking.length, line));
	const show = input.show_name === false ? 0 : 1;
	await env.DB.prepare(
		`INSERT INTO poll_votes (poll_id, registration_id, ranking, above_line, show_name, updated_at) VALUES (?,?,?,?,?,?)
		 ON CONFLICT(poll_id, registration_id) DO UPDATE SET ranking = excluded.ranking, above_line = excluded.above_line, show_name = excluded.show_name, updated_at = excluded.updated_at`,
	).bind(p.id, reg.id, JSON.stringify(ranking), above, show, nowIso()).run();
	return pollView(env, reg.id);
}

/**
 * Adds a voter's own option. It goes live straight away if the automatic check approves it; otherwise it waits for
 * an organiser, visible only to the person who suggested it. The organisers are emailed about every suggestion, with
 * the check's verdict, so anything wrongly approved can be removed from the admin page at once.
 */
export async function suggest(env: Env, regId: string, input: Record<string, unknown>) {
	const { reg, p } = await ballotContext(env, regId, input.poll);
	const label = cleanText(input.label, 80);
	if (!label) throw new UserError('Please say what you would like to do.');
	const detail = cleanText(input.detail, 200);
	const options = await getOptions(env, p.id);
	if (options.filter((o) => o.suggested_by === reg.id).length >= MAX_SUGGESTIONS) throw new UserError(`You can suggest up to ${MAX_SUGGESTIONS} options.`, 409);
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
	const same = options.find((o) => o.status !== 'removed' && norm(o.label) === norm(label));
	if (same) throw new UserError(`"${same.label}" is already an option${same.status === 'review' ? ' (waiting for review)' : ''}.`, 409);

	const ev = await getEvent(env, p.event_id);
	const b = brand(env);
	const check = await checkSuggestion(env, { org: b.org, event: ev.title, question: p.question }, { label, detail });
	const id = randomToken(9);
	const now = nowIso();
	const sort = Math.max(0, ...options.map((o) => o.sort)) + 1;
	await env.DB.prepare('INSERT INTO poll_options (id, poll_id, label, detail, url, status, suggested_by, check_note, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
		.bind(id, p.id, label, detail, null, check.approve ? 'approved' : 'review', reg.id, check.reason, sort, now).run();
	// The suggester will usually want it in their own ranking: add it just above their line, keeping the rest as it was.
	const mine = await env.DB.prepare('SELECT * FROM poll_votes WHERE poll_id = ? AND registration_id = ?').bind(p.id, reg.id).first<VoteRow>();
	if (mine) {
		const r = JSON.parse(mine.ranking) as string[];
		r.splice(mine.above_line, 0, id);
		await env.DB.prepare('UPDATE poll_votes SET ranking = ?, above_line = ?, updated_at = ? WHERE poll_id = ? AND registration_id = ?')
			.bind(JSON.stringify(r), mine.above_line + 1, now, p.id, reg.id).run();
	}
	try {
		await sendEmail(env, notification(b, `${check.approve ? 'New poll option (live)' : 'Poll suggestion to review'}: ${ev.title}`, [
			`${reg.name} suggested "${label}"${detail ? ` (${detail})` : ''} for "${p.question}".`,
			check.approve ? `The automatic check approved it, so voters can already see it: ${check.reason}` : `It is waiting for you, visible only to ${firstName(reg.name)}: ${check.reason}`,
			`Approve or remove it on the admin page: ${siteUrl(env)}/admin/rsvps/?event=${encodeURIComponent(ev.id)}#h-poll`,
		]));
	} catch (e) { console.error('suggestion notification failed', e); }
	return { ...(await pollView(env, reg.id)), suggestion: { id, status: check.approve ? 'approved' : 'review' } };
}

// ---------- admin ----------

/** Everything an organiser needs: every option with its status and check note, the full tally with every voter's
 * name (organisers see names even for voters who asked not to be named to others), and each ballot. */
export async function adminPolls(env: Env, eventId: string) {
	const ev = await getEvent(env, eventId);
	const sessions = await getSessions(env, ev.id);
	const regs = await regsFor(env, ev.id);
	const out = [];
	for (const p of await getPolls(env, ev.id)) {
		const options = await getOptions(env, p.id);
		const votes = await getVotes(env, p.id);
		const label = (id: string) => options.find((o) => o.id === id)?.label ?? '(deleted)';
		out.push({
			...p, open: pollOpen(p), session_label: sessions.find((s: SessionRow) => s.id === p.session_id)?.label ?? null,
			options: options.map((o) => ({ ...o, suggested_by_name: o.suggested_by ? regs.get(o.suggested_by)?.name ?? '(cancelled)' : null })),
			...tally(p, options, votes, regs, { allNames: true }),
			ballots: votes.filter((v) => regs.has(v.registration_id)).map((v) => {
				const r = JSON.parse(v.ranking) as string[];
				return { name: regs.get(v.registration_id)!.name, counted: canVote(p, regs.get(v.registration_id)!), going: r.slice(0, v.above_line).map(label), not_going: r.slice(v.above_line).map(label), show_name: !!v.show_name, updated_at: v.updated_at };
			}),
		});
	}
	return { ok: true as const, polls: out };
}

export async function setOptionStatus(env: Env, input: Record<string, unknown>) {
	const status = input.status === 'approved' || input.status === 'removed' || input.status === 'review' ? input.status : null;
	if (!status) throw new UserError('Unknown status.');
	const r = await env.DB.prepare('UPDATE poll_options SET status = ? WHERE id = ? RETURNING id').bind(status, String(input.id ?? '')).first();
	if (!r) throw new UserError('Unknown option.', 404);
	return { ok: true as const };
}

export async function addOption(env: Env, input: Record<string, unknown>) {
	const p = await getPoll(env, String(input.poll ?? ''));
	const label = cleanText(input.label, 80);
	if (!label) throw new UserError('Label is required.');
	const url = cleanText(input.url, 500);
	if (url && (!/^https:\/\//.test(url) || /\s/.test(url))) throw new UserError('Links must start with https:// and contain no spaces.');
	const sort = ((await env.DB.prepare('SELECT MAX(sort) AS m FROM poll_options WHERE poll_id = ?').bind(p.id).first<{ m: number | null }>())?.m ?? 0) + 1;
	await env.DB.prepare('INSERT INTO poll_options (id, poll_id, label, detail, url, status, suggested_by, check_note, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
		.bind(randomToken(9), p.id, label, cleanText(input.detail, 200), url, 'approved', null, 'Added by an organiser', sort, nowIso()).run();
	return { ok: true as const };
}

/** Organisers can edit an option's wording (e.g. name the club once it is chosen); voters' rankings are unaffected. */
export async function editOption(env: Env, input: Record<string, unknown>) {
	const label = cleanText(input.label, 80);
	if (!label) throw new UserError('Label is required.');
	const url = cleanText(input.url, 500);
	if (url && (!/^https:\/\//.test(url) || /\s/.test(url))) throw new UserError('Links must start with https:// and contain no spaces.');
	const r = await env.DB.prepare('UPDATE poll_options SET label = ?, detail = ?, url = ? WHERE id = ? RETURNING id')
		.bind(label, cleanText(input.detail, 200), url, String(input.id ?? '')).first();
	if (!r) throw new UserError('Unknown option.', 404);
	return { ok: true as const };
}

export async function updatePoll(env: Env, input: Record<string, unknown>) {
	const p = await getPoll(env, String(input.poll ?? ''));
	const t = Date.parse(String(input.closes_at ?? ''));
	if (Number.isNaN(t)) throw new UserError('Invalid closing time.');
	const question = cleanText(input.question, 200) ?? p.question;
	await env.DB.prepare('UPDATE polls SET closes_at = ?, question = ? WHERE id = ?').bind(new Date(t).toISOString(), question, p.id).run();
	return { ok: true as const };
}
