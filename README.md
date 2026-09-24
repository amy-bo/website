# amybo.org

The website of [AMYBO](https://amybo.org), a non-profit open source protein fermentation community: sustainable protein for all.

Built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build), hosted on [Cloudflare Pages](https://pages.cloudflare.com), with a small event-registration system on Pages Functions and D1.

## Credits

- **Design and structure:** Amy Andrews, whose 2025 Astro redesign (originally [myndrws/amybo](https://github.com/myndrws/amybo)) is the base of this repository, with its full history.
- **Content:** carried over from the previous Hugo/Docsy site ([amy-bo/pages](https://github.com/amy-bo/pages)) and its contributors.
- **Homepage photo:** [Ozark Drones](https://unsplash.com/@ozarkdrones?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash) on [Unsplash](https://unsplash.com/photos/birds-eye-view-photo-of-trees-jeV-LUEyJoE?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash), edited.

Every page's frontmatter records where its text came from (`source: amy | hugo | new`). [REVIEW.md](REVIEW.md) lists every page with its source and confirms each old Hugo URL still works.

## Working on the site

Requires Node.js 20 or later.

```sh
npm install
npm run dev          # http://localhost:4321
npm run build        # static site into dist/
npm run check        # astro check + type-check of the functions and cron worker
npm run review       # regenerate REVIEW.md (after a build)
npm run test:a11y    # axe-core accessibility scan of dist/ (after a build)
npm run test:e2e     # full registration flow against a local D1 database (after a build)
```

Pages live in `src/content/docs/`; the file path is the URL. Images go next to the page that uses them. See the [contribution guidelines](https://amybo.org/docs/contribution-guidelines/).

```
src/content/docs/        pages (docs/ holds everything migrated from the Hugo site)
src/content/talks/       talks for event pages (one markdown file per talk)
src/components/          Amy's Hero and Header overrides, event components
src/pages/admin/rsvps    private registrations admin page
functions/               Cloudflare Pages Functions: /api/rsvp/*, /api/admin/*
server/                  shared registration logic, email templates, Access and Turnstile checks
workers/cron/            companion Worker that runs the scheduled jobs every 5 minutes
migrations/              D1 database schema and seed data for the 13 November 2026 event
public/_redirects        old Hugo URLs with no direct equivalent
migration/hugo-map.json  every Hugo file and where it went
```

## Events and registration

The 13 November 2026 get-together page is `src/content/docs/events/2026-11-13-london.mdx`.

**Adding talks.** Copy `src/content/talks/_example.md` to a new file, fill in the title, speaker, affiliation, bio and optionally a headshot (put the image in `src/content/talks/headshots/`), and set `published: true`. Until at least one talk is published, the page shows "Programme to be announced".

**How registration works.**

1. Someone fills in the form (name, email, in person or remote, optional lab tour, optional affiliation and needs, consent). Turnstile and a hidden honeypot field keep bots out.
2. They get a **"Complete registration"** email. Their place is held for 48 hours, or a third of the time left before the registration deadline if that is shorter. hello@amybo.org is told when half the hold has passed, and the registration is deleted if it is not confirmed in time.
3. When they confirm, they get the **latest joining instructions**. If in-person places are full they join the waiting list instead, and hello@amybo.org is told. Lab tours have their own capacities and waiting lists.
4. Every email carries a personal **manage link** to view, change or cancel. Cancelling deletes the registration, confirms by email and tells hello@amybo.org.

Freed places are never handed out automatically: someone on the waiting list moves up only when an admin clicks **Promote**, which sends them the joining instructions.

**The only automatic emails** are: confirm your email, joining instructions (on confirmation or promotion), cancellation confirmation, and notifications to hello@amybo.org. Editing a page or saving new joining instructions never emails anyone.

**Admin page:** [amybo.org/admin/rsvps](https://amybo.org/admin/rsvps/), behind Cloudflare Access. It shows counts and every registration, and lets you:

- change the in-person maximum, tour capacities and registration deadline
- promote people from waiting lists, or remove spam
- download a CSV, or copy a BCC list for sending from Gmail (always paste into BCC, never To or CC)
- save a new version of the joining instructions, which new registrants then receive
- email all confirmed registrants, or a filtered group (in person or remote, a tour, people on an older joining-instructions version), now or at a scheduled time, and cancel a scheduled email
- download the **sent log** as markdown: every joining-instructions version, who has which version, and every message sent

**Updating joining instructions without spamming anyone.** Download the sent log and ask Claude to draft the next version plus a short "what's changed" message. Save the new version, then send the "what's changed" message to *people on an older version*, ticking *counts as joining instructions version N*. Everyone ends up with everything, and nobody gets the same information twice.

**Data retention.** A scheduled job deletes the event's registrations and their email records 30 days after the event ends. See the [privacy notice](https://amybo.org/privacy/).

## Setting up Cloudflare (first deploy)

You need a Cloudflare account with the amybo.org zone (already there, since DNS is on Cloudflare), and admin rights on the amy-bo GitHub organisation.

1. **Create the database.**

   ```sh
   npx wrangler login
   npx wrangler d1 create amybo-rsvp
   ```

   Put the printed `database_id` into both `wrangler.toml` and `workers/cron/wrangler.toml`, commit, then create the tables:

   ```sh
   npx wrangler d1 migrations apply amybo-rsvp --remote
   ```

2. **Connect GitHub.** In the Cloudflare dashboard: Workers & Pages → Create → Pages → Connect to Git. When GitHub asks, install the Cloudflare Pages app on the **amy-bo** organisation and give it access to **only** the `website` repository. Choose `amy-bo/website`, production branch `main`, framework preset Astro, build command `npm run build`, output directory `dist`. Add the build variable `NODE_VERSION` = `20`. Pages reads the D1 binding and variables from `wrangler.toml`.

3. **Turnstile.** Dashboard → Turnstile → Add widget for `amybo.org` (and `amybo.pages.dev` for previews), managed mode. Add the **site key** as the Pages build variable `PUBLIC_TURNSTILE_SITE_KEY`, and the **secret key** as the secret `TURNSTILE_SECRET_KEY`.

4. **Resend.** In Resend, add the domain `amybo.org`. Resend shows a few DNS records (an MX and a TXT record on a `send` subdomain, and a DKIM TXT record). Add them in Cloudflare DNS with the proxy **off** (DNS only), then click Verify in Resend. These records sit on subdomains, so Google mail for hello@amybo.org keeps working. Create an API key with **sending access** only.

5. **Secrets.** In the Pages project → Settings → Variables and secrets, for Production (and Preview if you use previews):

   | Secret | Value |
   | --- | --- |
   | `TOKEN_SECRET` | output of `openssl rand -hex 32`; keep it stable, because changing it breaks every link already emailed |
   | `RESEND_API_KEY` | the Resend key |
   | `TURNSTILE_SECRET_KEY` | the Turnstile secret key |

   Never set `DEV_MODE` on Cloudflare.

6. **Cloudflare Access for the admin page.** Zero Trust → Access → Applications → Add → Self-hosted. Add these destinations: `amybo.org/admin/*`, `amybo.org/api/admin/*`, `*.amybo.pages.dev/admin/*` and `*.amybo.pages.dev/api/admin/*`. Add a policy *Allow* for the admins' email addresses (one-time PIN login works without any extra setup). Save, then copy the application's **Audience (AUD) tag** into `ACCESS_AUD` in `wrangler.toml`, and your team domain (Zero Trust → Settings → Custom pages, e.g. `amybo.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`. Commit and push. The functions refuse admin requests without a valid Access token even if the Access policy is misconfigured.

7. **Cron Worker.** Deploy the scheduled-jobs Worker and give it the same secrets:

   ```sh
   npx wrangler deploy --config workers/cron/wrangler.toml
   npx wrangler secret put TOKEN_SECRET --config workers/cron/wrangler.toml
   npx wrangler secret put RESEND_API_KEY --config workers/cron/wrangler.toml
   ```

8. **Test on the preview URL** (`https://amybo.pages.dev`): register with your own email, confirm, change and cancel; open `/admin/rsvps/` and check it asks you to log in.

Local development of the functions: copy `.dev.vars.example` to `.dev.vars`, fill in `TOKEN_SECRET`, then `npm run build && npm run db:migrate:local && npm run pages:dev` and open http://localhost:8788. Emails are printed to the console and stored in a local outbox instead of being sent.

## Cut-over from Netlify to Cloudflare Pages

- [ ] Steps 1 to 8 above done, and the preview site checked page by page against the live site (REVIEW.md lists every page).
- [ ] Event page facts confirmed: times, room and entrance, in-person maximum, tour capacities and registration deadline (set on the admin page).
- [ ] Joining instructions version 1 checked on the admin page, including the Google Meet link and room details (or a note that they will follow).
- [ ] Resend domain shows **Verified**; a test registration email arrives and is not in spam.
- [ ] In Pages → Custom domains, add `amybo.org` and `www.amybo.org`. Cloudflare replaces the existing DNS records that point at Netlify. Wait for the certificate to show Active.
- [ ] Check https://amybo.org, a few old URLs (for example `/docs/overview/`, `/docs/pioflo/pioflo-v0.01/`, `/about/`), the event page, registration end to end, and that `/admin/rsvps/` needs a login.
- [ ] In Netlify, remove the custom domain from the old site, then delete or disable the site so it stops building.
- [ ] Archive the `amy-bo/pages` repository with a README note pointing to `amy-bo/website`.
- [ ] Update links that point at the old repository (forum, YouTube descriptions, GitHub organisation profile).

**Rollback:** in Cloudflare DNS, point `amybo.org` back at the Netlify site (the Netlify site keeps working until it is deleted), so do not delete it until the new site has run cleanly for a while.

## Licence

The code is under the MIT licence in [LICENSE](LICENSE), from Amy Andrews' original repository. A licence for the page content has not been chosen yet.
