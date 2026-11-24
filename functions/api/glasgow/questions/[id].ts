// Live lecture polling: PUT (create or replace) and DELETE a question, with X-Presenter-Token. No deploy needed.
import { preflight } from '../../../../src/glasgow/core';
import { deleteQuestion, putQuestion, type GlasgowEnv } from '../../../../src/glasgow/db';

type Ctx = EventContext<GlasgowEnv, 'id', unknown>;
const idOf = (ctx: Ctx) => String(ctx.params.id ?? '');
export const onRequestPut = (ctx: Ctx) => putQuestion(ctx.env, ctx.request, idOf(ctx));
export const onRequestDelete = (ctx: Ctx) => deleteQuestion(ctx.env, ctx.request, idOf(ctx));
export const onRequestOptions = preflight;
