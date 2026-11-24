// Live lecture polling: POST {q} or {all: true} with X-Presenter-Token: wipe a rehearsal.
import { preflight } from '../../../src/glasgow/core';
import { postClear } from '../../../src/glasgow/audience';
import type { GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postClear(env, request);
export const onRequestOptions = preflight;
