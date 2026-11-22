// Live lecture polling: POST {q} (or {q: null}) with X-Presenter-Token: which question the phones show.
import { preflight } from '../../../src/glasgow/core';
import { postCurrent, type GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postCurrent(env, request);
export const onRequestOptions = preflight;
