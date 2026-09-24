import { handle } from '../../../server/http';
import { adminSummary } from '../../../server/rsvp';

export const onRequestGet = handle(async ({ env, request }) => adminSummary(env, new URL(request.url).searchParams.get('event') || ''));
