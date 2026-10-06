// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import type { Env } from '../../env';
import { handle, readJson } from '../../http';
import { pollView, suggest, vote } from '../../poll';
import { UserError } from '../../rsvp';
import { readToken } from '../../tokens';

/** Polls use the registrant's manage link: whoever can change the registration can vote for it. */
async function idFrom(env: Env, t: unknown) {
	const id = await readToken(env, 'manage', t);
	if (!id) throw new UserError('This link is not valid.', 404);
	return id;
}

export const onRequestGet = handle(async ({ env, request }) => pollView(env, await idFrom(env, new URL(request.url).searchParams.get('t'))));

/** { t, poll, action: 'vote', ranking: [ids], above_line, show_name } or { t, poll, action: 'suggest', label, detail }. */
export const onRequestPost = handle(async ({ env, request }) => {
	const body = await readJson(request);
	const id = await idFrom(env, body.t);
	if (body.action === 'suggest') return suggest(env, id, body);
	if (body.action === 'vote') return vote(env, id, body);
	throw new UserError('Unknown action.');
});
