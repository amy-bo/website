import { handle, readJson } from '../../../server/http';
import { cancel, manageView, updateRegistration, UserError } from '../../../server/rsvp';
import { readToken } from '../../../server/tokens';

async function idFrom(env: Parameters<typeof readToken>[0], t: unknown) {
	const id = await readToken(env, 'manage', t);
	if (!id) throw new UserError('This link is not valid.', 404);
	return id;
}

export const onRequestGet = handle(async ({ env, request }) => manageView(env, await idFrom(env, new URL(request.url).searchParams.get('t'))));

export const onRequestPost = handle(async ({ env, request }) => {
	const body = await readJson(request);
	return updateRegistration(env, await idFrom(env, body.t), body);
});

export const onRequestDelete = handle(async ({ env, request }) => {
	const body = await readJson(request);
	return cancel(env, await idFrom(env, body.t));
});
