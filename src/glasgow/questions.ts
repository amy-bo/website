// Live lecture polling: the questions themselves, kept in D1 so the presenter can add and edit them from the slides
// with no deploy. A set's questions are seeded once from src/glasgow/sets.ts; after that the database is the truth.
import type { NumberQuestion, Question, QuestionSet, TextQuestion } from './sets';

export const QUESTION_ID_RE = /^[a-z0-9_-]{1,24}$/;
export const MAX_PROMPT = 200;

/** Histogram bins when none are given: a bar per choice for a few whole-number choices, a bar per factor of ten on a
 *  log scale, otherwise ten equal bars. Every bin holds from ≤ v < to; the last also takes max. */
export function defaultBins(q: Pick<NumberQuestion, 'min' | 'max' | 'step' | 'scale'>): number[] {
	const { min, max, step } = q;
	const r = (n: number) => Number(n.toPrecision(12));
	if (q.scale === 'log') {
		const out = [min];
		for (let e = Math.floor(Math.log10(min)) + 1; 10 ** e < max; e++) out.push(r(10 ** e));
		out.push(max);
		return out;
	}
	const choices = Math.round((max - min) / step) + 1;
	if (Number.isInteger(step) && Number.isInteger(min) && choices <= 12) {
		// 1, 1.5, 2.5, …, max: one bin per whole-number choice.
		const out = [min];
		for (let v = min + step; v <= max - step / 2; v += step) out.push(r(v - step / 2));
		out.push(r(max - step / 2), max);
		return [...new Set(out)].sort((a, b) => a - b);
	}
	return Array.from({ length: 11 }, (_, i) => r(min + ((max - min) * i) / 10));
}

export type Checked = { ok: true; question: Question; order: number | null } | { ok: false; error: string };

/** A question as sent by the presenter, checked strictly. */
export function checkQuestion(id: string, body: any): Checked {
	if (!QUESTION_ID_RE.test(id)) return { ok: false, error: 'The id must be 1 to 24 characters of a–z, 0–9, _ or -.' };
	if (body?.id !== undefined && body.id !== id) return { ok: false, error: 'The id in the body does not match the address.' };
	const prompt = typeof body?.prompt === 'string' ? body.prompt.replace(/\s+/g, ' ').trim() : '';
	if (!prompt) return { ok: false, error: 'Please give the question ("prompt").' };
	if ([...prompt].length > MAX_PROMPT) return { ok: false, error: `Please keep the question to ${MAX_PROMPT} characters.` };
	const order = body?.order === undefined || body?.order === null ? null : Number(body.order);
	if (order !== null && !Number.isInteger(order)) return { ok: false, error: '"order" must be a whole number.' };
	const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
	if (body?.type === 'number') {
		const { min, max, step } = body;
		if (!finite(min) || !finite(max) || !finite(step)) return { ok: false, error: 'A number question needs numbers "min", "max" and "step".' };
		if (!(min < max)) return { ok: false, error: '"min" must be less than "max".' };
		if (!(step > 0) || step > max - min) return { ok: false, error: '"step" must be more than 0 and no more than max − min.' };
		if (Math.abs(min) > 1e9 || Math.abs(max) > 1e9 || step < 1e-9) return { ok: false, error: 'Those numbers are out of range.' };
		const scale = body.scale === undefined ? 'linear' : body.scale;
		if (scale !== 'linear' && scale !== 'log') return { ok: false, error: '"scale" must be "linear" or "log".' };
		if (scale === 'log' && !(min > 0)) return { ok: false, error: 'A log scale needs "min" above 0.' };
		const unit = body.unit === undefined || body.unit === null ? '' : body.unit;
		if (typeof unit !== 'string' || [...unit].length > 12) return { ok: false, error: '"unit" must be text of up to 12 characters.' };
		const q: NumberQuestion = { id, type: 'number', prompt, min, max, step, scale, unit, bins: [] };
		q.bins = Array.isArray(body.bins) && body.bins.length >= 2 && body.bins.every(finite) && body.bins[0] === min && body.bins.at(-1) === max
			&& body.bins.every((b: number, i: number) => i === 0 || b > body.bins[i - 1]) ? body.bins : defaultBins(q);
		return { ok: true, question: q, order };
	}
	if (body?.type === 'text') {
		const maxLength = body.maxLength === undefined ? 80 : body.maxLength;
		if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 500) return { ok: false, error: '"maxLength" must be a whole number from 1 to 500.' };
		if (body.multiple !== undefined && typeof body.multiple !== 'boolean') return { ok: false, error: '"multiple" must be true or false.' };
		const q: TextQuestion = { id, type: 'text', prompt, maxLength };
		if (body.multiple) {
			const per = body.maxPerDevice === undefined ? 30 : body.maxPerDevice;
			if (!Number.isInteger(per) || per < 1 || per > 1000) return { ok: false, error: '"maxPerDevice" must be a whole number from 1 to 1000.' };
			q.multiple = true; q.maxPerDevice = per;
		}
		return { ok: true, question: q, order };
	}
	return { ok: false, error: '"type" must be "number" or "text".' };
}

/** What /state shows: the question without its bins. */
export const publicQuestion = (q: Question) => { const { bins: _b, ...rest } = q as NumberQuestion; return rest as Omit<Question, 'bins'>; };

/** The seed, for a set that has never had its questions stored. */
export const seedRows = (set: QuestionSet) => set.questions.map((q, i) => ({ id: q.id, order: (i + 1) * 10, def: JSON.stringify(q) }));
