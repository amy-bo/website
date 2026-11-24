// Live lecture polling: GET with X-Presenter-Token: hands up and every question, for the presenter only.
import { preflight } from '../../../src/glasgow/core';
import { getAudience } from '../../../src/glasgow/audience';
import type { GlasgowEnv } from '../../../src/glasgow/db';

export const onRequestGet = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => getAudience(env, request);
export const onRequestOptions = preflight;
