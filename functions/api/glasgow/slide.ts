// Live lecture polling: POST {n, key} with X-Presenter-Token: the slide showing, stamped on new questions.
import { preflight } from '../../../src/glasgow/core';
import { postSlide } from '../../../src/glasgow/audience';
import type { GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postSlide(env, request);
export const onRequestOptions = preflight;
