// Live lecture polling: POST {q, value, device}: one answer per device per question, replaced if sent again.
import { preflight } from '../../../src/glasgow/core';
import { postAnswer, type GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postAnswer(env, request);
export const onRequestOptions = preflight;
