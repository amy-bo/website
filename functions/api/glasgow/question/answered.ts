// Live lecture polling: POST {id, answered} with X-Presenter-Token: tick a question off.
import { preflight } from '../../../../src/glasgow/core';
import { postAnswered } from '../../../../src/glasgow/audience';
import type { GlasgowEnv } from '../../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postAnswered(env, request);
export const onRequestOptions = preflight;
