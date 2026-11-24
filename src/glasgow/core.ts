// Live lecture polling: validation, aggregation and the HTTP helpers, kept free of D1 so they can be unit-tested.
import type { ChoiceQuestion, NumberQuestion, Question, TextQuestion } from './sets';

export const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
	'access-control-allow-headers': 'content-type, x-presenter-token',
	'access-control-max-age': '86400',
};
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS };

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
export const fail = (status: number, error: string) => json({ ok: false, error }, status);
export const preflight = () => new Response(null, { status: 204, headers: CORS });

export const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** A small, deliberately short word list: anything matching is stored but never shown. The presenter can hide more. */
const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'bastard', 'wank', 'twat', 'dick', 'cock', 'pussy', 'slut', 'whore', 'fag', 'nigg', 'retard', 'rape', 'nazi', 'spastic', 'paki', 'kike', 'tranny', 'arsehole', 'asshole', 'bollock', 'prick', 'piss'];
export function isBlocked(text: string) {
	// Letters only, with common look-alike digits and symbols folded in, so "f.u.c.k" and "sh1t" are caught too.
	const folded = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
		.replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[4]/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't')
		.replace(/[^a-z]/g, '');
	return BLOCKED.some((w) => folded.includes(w));
}

export type Checked = { ok: true; num: number | null; text: string | null } | { ok: false; error: string };

/** One answer, checked against its question. Numbers are rounded to the question's step; texts are tidied. */
export function checkAnswer(q: Question, value: unknown): Checked {
	if (q.type === 'number') {
		const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
		if (!Number.isFinite(n)) return { ok: false, error: 'Please give a number.' };
		if (n < q.min || n > q.max) return { ok: false, error: `Please give a number from ${q.min} to ${q.max}.` };
		const decimals = Math.max(0, -Math.floor(Math.log10(q.step) + 1e-9));
		return { ok: true, num: Number(n.toFixed(decimals)), text: null };
	}
	if (q.type === 'choice') {
		const i = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
		if (!Number.isInteger(i) || i < 0 || i >= q.options.length) return { ok: false, error: 'Please choose one of the options.' };
		return { ok: true, num: i, text: null };
	}
	if (typeof value !== 'string') return { ok: false, error: 'Please type an answer.' };
	const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
	if (!text) return { ok: false, error: 'Please type an answer.' };
	if ([...text].length > q.maxLength) return { ok: false, error: `Please keep it to ${q.maxLength} characters.` };
	return { ok: true, num: null, text };
}

const median = (sorted: number[]) => !sorted.length ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Totals for a number question: every value (sorted), mean, median, and counts in the question's bins. */
export function numberResults(q: NumberQuestion, values: number[]) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	const bins = q.bins.slice(0, -1).map((from, i) => ({ from, to: q.bins[i + 1], n: 0 }));
	for (const v of sorted) {
		// Each bin holds from ≤ v < to; the last also takes its upper edge.
		const b = bins.findIndex((x, i) => v >= x.from && (v < x.to || (i === bins.length - 1 && v <= x.to)));
		if (b >= 0) bins[b].n++;
	}
	const m = median(sorted);
	return { type: 'number' as const, count: sorted.length, mean: sorted.length ? round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null, median: m === null ? null : round(m), values: sorted, bins };
}

/** Totals for a choice question: how many chose each option, in the options' order. */
export function choiceResults(q: ChoiceQuestion, values: number[]) {
	const counts = q.options.map(() => 0);
	for (const v of values) if (Number.isInteger(v) && v >= 0 && v < counts.length) counts[v]++;
	return { type: 'choice' as const, options: q.options, counts, count: counts.reduce((a, b) => a + b, 0) };
}

/** Answers grouped for a word cloud: case-insensitive, spaces collapsed; each shown with its first-sent spelling. */
export function wordCounts(rows: { text: string; at: string }[]) {
	const groups = new Map<string, { text: string; n: number; first: string }>();
	for (const r of rows) {
		const text = r.text.replace(/\s+/g, ' ').trim();
		if (!text) continue;
		const key = text.toLocaleLowerCase('en-GB');
		const g = groups.get(key);
		if (!g) groups.set(key, { text, n: 1, first: r.at });
		else { g.n++; if (r.at < g.first) { g.first = r.at; g.text = text; } }
	}
	return [...groups.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text)).map(({ text, n }) => ({ text, n }));
}

/** rows: every shown answer, newest first. A word-cloud question lists them all; others the latest 30. */
export function textResults(q: TextQuestion, rows: { id: number; text: string; at: string }[]) {
	return { type: 'text' as const, count: rows.length, texts: q.multiple ? rows : rows.slice(0, 30), words: wordCounts(rows) };
}

/** A presenter token check that takes the same time whatever the guess. */
export function tokenMatches(given: string | null, expected: string | undefined) {
	if (!expected || !given) return false;
	const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
	let diff = a.length ^ b.length;
	for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}

/** A keyed hash of the address, for rate limiting only: never the address itself, and deleted within the hour. */
export async function rateKey(ip: string, secret: string) {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret || 'glasgow'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
	return [...sig.slice(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
