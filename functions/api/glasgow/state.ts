// Live lecture polling: GET the current question and the question set. Open to any origin (the slide is a local file).
import { preflight } from '../../../src/glasgow/core';
import { getState, type GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestGet = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => getState(env, new URL(request.url).searchParams.get('set'));
export const onRequestOptions = preflight;
