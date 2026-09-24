import { handle, readJson } from '../../../server/http';
import { confirm, UserError } from '../../../server/rsvp';
import { readToken } from '../../../server/tokens';

/** POST only, so email link scanners that prefetch GET URLs cannot confirm on someone's behalf. */
export const onRequestPost = handle(async ({ env, request }) => {
	const { t } = await readJson(request);
	const id = await readToken(env, 'confirm', t);
	if (!id) throw new UserError('This confirmation link is not valid.', 404);
	return confirm(env, id);
});
