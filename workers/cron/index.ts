// The amybo.org cron Worker: Events&I's scheduled jobs, plus deleting lecture-poll answers after their retention date,
// and deleting remote-access applications (and taking people off the Pis' Access policies) when their course has ended.
import events from '../../eventsandeye/worker/index';
import { purge } from '../../src/glasgow/db';
import { purge as purgeRemote, type Env as RemoteEnv } from '../../src/remote/server';

export default {
	...events,
	async scheduled(event: ScheduledController, env: RemoteEnv, ctx: ExecutionContext) {
		await events.scheduled(event, env, ctx);
		ctx.waitUntil(purge(env).then((r) => console.log('glasgow purge', JSON.stringify(r))).catch((e) => console.error('glasgow purge failed', e)));
		// Hourly is plenty (the cron runs every 5 minutes), and keeps a failing Access sync from calling Cloudflare all day.
		if (new Date(event.scheduledTime).getUTCMinutes() < 5) ctx.waitUntil(purgeRemote(env).then((r) => console.log('remote purge', JSON.stringify(r))).catch((e) => console.error('remote purge failed', e)));
	},
} satisfies ExportedHandler<RemoteEnv>;
