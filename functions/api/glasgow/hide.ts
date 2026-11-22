// Live lecture polling: POST {q, id, hidden} with X-Presenter-Token: hide a text answer from the results, or show it again.
import { preflight } from '../../../src/glasgow/core';
import { postHide, type GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postHide(env, request);
export const onRequestOptions = preflight;
