// Live lecture polling: GET ?q=<id> totals for one question (counts and values only; never devices).
import { preflight } from '../../../src/glasgow/core';
import { getResults, type GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestGet = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => {
	const p = new URL(request.url).searchParams;
	return getResults(env, p.get('set'), p.get('q'));
};
export const onRequestOptions = preflight;
