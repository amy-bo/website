// Live lecture polling: POST with X-Presenter-Token: lower every hand.
import { preflight } from '../../../../src/glasgow/core';
import { postClearHands } from '../../../../src/glasgow/audience';
import type { GlasgowEnv } from '../../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postClearHands(env, request);
export const onRequestOptions = preflight;
