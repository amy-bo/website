import { handle, readJson } from '../../../../server/http';
import { cancelMessage } from '../../../../server/rsvp';

export const onRequestPost = handle(async ({ env, request }) => cancelMessage(env, String((await readJson(request)).id || '')));
