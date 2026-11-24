// Live lecture polling: POST {id, …} with X-Presenter-Token: the same as PUT /questions/<id>.
import { preflight } from '../../../../src/glasgow/core';
import { putQuestion, type GlasgowEnv } from '../../../../src/glasgow/db';

export const onRequestPost = async ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => {
	let id = '';
	try { id = String((await request.clone().json() as any)?.id ?? ''); } catch {}
	return putQuestion(env, request, id);
};
export const onRequestOptions = preflight;
