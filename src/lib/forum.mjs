// Latest threads from forum.amybo.org (Discourse), fetched once at build time.
//
// The build must never hang or fail because the forum is slow or unreachable, so the fetch has a
// hard timeout, the response shape is checked, and any problem at all returns an empty list. The
// homepage keeps its hand-picked threads whatever happens; the live list is an extra on top.

export const FORUM_URL = 'https://forum.amybo.org';

/** @typedef {{ id: number, title: string, url: string, posts: number, lastPosted: string }} ForumThread */

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] test seam
 * @param {number} [options.timeoutMs] default 5000
 * @param {number} [options.limit] default 6
 * @returns {Promise<ForumThread[]>} newest first; [] on any failure
 */
export async function getLatestThreads({ fetchImpl = globalThis.fetch, timeoutMs = 5000, limit = 6 } = {}) {
	if (process.env.FORUM_FEED === 'off') return [];
	if (process.env.FORUM_FIXTURE) {
		// A local latest.json (for example tests/fixtures/latest.json) stands in for the forum, to see the live layout offline.
		const { readFile } = await import('node:fs/promises');
		try {
			return parseLatest(JSON.parse(await readFile(process.env.FORUM_FIXTURE, 'utf8')), limit);
		} catch {
			return [];
		}
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(`${FORUM_URL}/latest.json`, {
			signal: controller.signal,
			headers: { accept: 'application/json', 'user-agent': 'amybo.org build (https://amybo.org)' },
		});
		if (!response.ok) return [];
		const data = await response.json();
		return parseLatest(data, limit);
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Turns Discourse's latest.json into ForumThread[], dropping anything that does not look right.
 * Exported for tests.
 * @param {unknown} data
 * @param {number} limit
 * @returns {ForumThread[]}
 */
export function parseLatest(data, limit = 6) {
	const topics = data && typeof data === 'object' && data.topic_list && Array.isArray(data.topic_list.topics)
		? data.topic_list.topics
		: null;
	if (!topics) return [];
	const out = [];
	for (const t of topics) {
		if (!t || typeof t !== 'object') continue;
		if (t.pinned === true || t.archived === true || t.visible === false) continue;
		const id = Number(t.id);
		const title = typeof t.title === 'string' ? t.title.trim() : '';
		const slug = typeof t.slug === 'string' ? t.slug : '';
		if (!Number.isInteger(id) || id <= 0 || !title || !/^[a-z0-9-]+$/.test(slug)) continue;
		const posts = Number.isInteger(t.posts_count) && t.posts_count > 0 ? t.posts_count : 1;
		const lastPosted = typeof t.last_posted_at === 'string' && !Number.isNaN(Date.parse(t.last_posted_at))
			? t.last_posted_at
			: typeof t.created_at === 'string' && !Number.isNaN(Date.parse(t.created_at)) ? t.created_at : '';
		out.push({ id, title, url: `${FORUM_URL}/t/${slug}/${id}`, posts, lastPosted });
		if (out.length >= limit) break;
	}
	return out;
}

/** "3 replies", "12 Sep 2026" style helpers for the template. */
export function describe(thread) {
	const replies = thread.posts - 1;
	const when = thread.lastPosted
		? new Date(thread.lastPosted).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
		: '';
	const count = replies === 0 ? 'no replies yet' : replies === 1 ? '1 reply' : `${replies} replies`;
	return when ? `${count}, ${when}` : count;
}
