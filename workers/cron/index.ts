// The amybo.org cron Worker: Events&I's scheduled jobs, plus deleting lecture-poll answers after their retention date.
import events from '../../eventsandeye/worker/index';
import { purge } from '../../src/glasgow/db';
import type { Env } from '../../eventsandeye/src/env';

export default {
	...events,
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
		await events.scheduled(event, env, ctx);
		ctx.waitUntil(purge(env).then((r) => console.log('glasgow purge', JSON.stringify(r))).catch((e) => console.error('glasgow purge failed', e)));
	},
} satisfies ExportedHandler<Env>;
