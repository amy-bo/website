// Live lecture polling: POST {q} (and "discardRestored": true for restored totals) with X-Presenter-Token: unfreeze.
import { preflight } from '../../../src/glasgow/core';
import { postUnfreeze, type GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postUnfreeze(env, request);
export const onRequestOptions = preflight;
