// Live lecture polling: POST {q} with X-Presenter-Token: freeze a poll (no answers, never current, never cleared).
import { preflight } from '../../../src/glasgow/core';
import { postFreeze, type GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postFreeze(env, request);
export const onRequestOptions = preflight;
