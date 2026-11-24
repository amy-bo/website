// Live lecture polling: POST {device, text}: a question or comment for the presenter.
import { preflight } from '../../../../src/glasgow/core';
import { postQuestion } from '../../../../src/glasgow/audience';
import type { GlasgowEnv } from '../../../../src/glasgow/db';

export const onRequestPost = ({ env, request }: EventContext<GlasgowEnv, string, unknown>) => postQuestion(env, request);
export const onRequestOptions = preflight;
