import type { Env } from '../../server/env';
import { runScheduled } from '../../server/rsvp';

/**
 * Companion Worker for the Pages site (Pages Functions have no cron triggers). Shares the same D1 database.
 * Every 5 minutes: sends due scheduled messages, handles unconfirmed-registration holds, applies the 30-day retention.
 */
export default {
	async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(runScheduled(env).then((r) => console.log('scheduled run', JSON.stringify(r))));
	},
	async fetch() {
		return new Response('amybo-cron: no HTTP interface', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
