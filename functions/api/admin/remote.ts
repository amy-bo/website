// Every change on /admin/remote/ (behind Cloudflare Access; ../_middleware.ts checks the Access token, origin and JSON).
import { postAdmin } from '../../../src/remote/server';

export const onRequestPost = postAdmin;
