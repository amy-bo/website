// Live lecture polling: POST {device, up}: a hand up or down.
import { preflight } from '../../../src/glasgow/core';
import { postHand } from '../../../src/glasgow/audience';
import type { GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postHand(env, request);
export const onRequestOptions = preflight;
