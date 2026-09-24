import { handle, readJson } from '../../../server/http';
import { mdToHtml } from '../../../server/markdown';

export const onRequestPost = handle(async ({ request }) => {
	const body = await readJson(request);
	return { ok: true, html: mdToHtml(typeof body.body_md === 'string' ? body.body_md : '') };
});
