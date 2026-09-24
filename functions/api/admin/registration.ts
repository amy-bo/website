import { handle, readJson } from '../../../server/http';
import { adminDelete } from '../../../server/rsvp';

/** Admin removal (e.g. spam). Sends no email. */
export const onRequestDelete = handle(async ({ env, request }) => adminDelete(env, String((await readJson(request)).id || '')));
