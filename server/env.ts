/// <reference types="@cloudflare/workers-types" />

export interface Env {
	DB: D1Database;
	/** Resend API key. Required on the live site; without it emails go to the dev outbox and console. */
	RESEND_API_KEY?: string;
	/** Sender, default "AMYBO <hello@amybo.org>". */
	EMAIL_FROM?: string;
	/** Where admin notifications go, default hello@amybo.org. */
	NOTIFY_EMAIL?: string;
	/** Public origin used in email links, default https://amybo.org. */
	SITE_URL?: string;
	/** Secret for signing self-service and confirmation links (32+ random bytes). Rotating it invalidates all links. */
	TOKEN_SECRET: string;
	TURNSTILE_SECRET_KEY?: string;
	/** Cloudflare Access team domain, e.g. amybo.cloudflareaccess.com */
	ACCESS_TEAM_DOMAIN?: string;
	/** Cloudflare Access application audience (AUD) tag. */
	ACCESS_AUD?: string;
	/** "true" only in local development: enables the dev outbox endpoints and test keys. Never set in production. */
	DEV_MODE?: string;
	/** Local development only: JSON Web Key Set used instead of the Access certs URL, for tests. */
	ACCESS_JWKS_JSON?: string;
}

export const isDev = (env: Env) => env.DEV_MODE === 'true';
export const siteUrl = (env: Env) => (env.SITE_URL || 'https://amybo.org').replace(/\/$/, '');
export const notifyEmail = (env: Env) => env.NOTIFY_EMAIL || 'hello@amybo.org';
export const emailFrom = (env: Env) => env.EMAIL_FROM || 'AMYBO <hello@amybo.org>';
