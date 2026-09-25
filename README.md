# amybo.org

The website of [AMYBO](https://amybo.org), a non-profit open source protein fermentation community: sustainable protein for all.

Built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build), hosted on [Cloudflare Pages](https://pages.cloudflare.com). Event registration uses [Events&I](https://github.com/andeyePro/eventsandeye) (beta), andeye's open source registration system on Pages Functions and D1; a copy lives in `eventsandeye/`.

## Credits

- **Design and structure:** Amy Andrews, whose 2025 Astro redesign (originally [myndrws/amybo](https://github.com/myndrws/amybo)) is the base of this repository, with its full history.
- **Content:** carried over from the previous Hugo/Docsy site ([amy-bo/pages](https://github.com/amy-bo/pages), private until it is archived) and its contributors.
- **Homepage photo:** [Ozark Drones](https://unsplash.com/@ozarkdrones?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash) on [Unsplash](https://unsplash.com/photos/birds-eye-view-photo-of-trees-jeV-LUEyJoE?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash), edited.

Every page's frontmatter records where its text came from (`source: amy | hugo | new`). [REVIEW.md](REVIEW.md) lists every page with its source and confirms each old Hugo URL still works.

## Working on the site

Requires Node.js 22 or later (`.nvmrc`). A project-local Node 22 is also installed as a dev dependency, so `npm run` scripts use it even where the system Node is older.

```sh
npm install
npm run dev          # http://localhost:4321
npm run build        # static site into dist/ (needs PUBLIC_TURNSTILE_SITE_KEY)
npm run build:test   # same, with Cloudflare's Turnstile test key, for local testing
npm run check        # astro check + type-check of the functions and cron worker
npm run review       # regenerate REVIEW.md (after a build)
npm run test:a11y    # axe-core accessibility scan of dist/ (after a build)
npm run test:e2e     # full registration flow against a local D1 database (after build:test)
node scripts/og.mjs  # regenerate the Open Graph images after changing the logo or event title
```

Pages live in `src/content/docs/`; the file path is the URL. Images go next to the page that uses them, or in `src/assets/photos/` (AMYBO's own photos, with their sources listed there). See the [contribution guidelines](https://amybo.org/collaborate/contribute/).

```
src/content/docs/        pages: Amy's section pages, projects/ (electroPioreactor, CARMA Hub, PioFlo, other hardware,
                         past projects), background/, collaborate/, events/, privacy, 404
src/content/talks/       talks for event pages (one markdown file per talk)
src/components/          Amy's Hero and Header overrides, footer, click-to-play YouTube embed, talks list
src/assets/photos/       AMYBO photos from amy-bo/electroPioreactor (CC BY-SA 4.0), resized by Astro at build time
scripts/                 og.mjs (Open Graph images), review.mjs (REVIEW.md), a11y.mjs (axe-core scan)
public/                  robots.txt, og.png and og-event.jpg, _redirects
eventsandeye/            Events&I registration system (AGPL-3.0): server code, admin page, cron worker, schema, tests, Astro components
functions/               one-line Cloudflare Pages Functions wrappers that route to Events&I
seed/                    the 13 November 2026 event, its sessions and first joining instructions
workers/cron/            wrangler config for the Events&I cron worker
public/_redirects        every old Hugo /docs/ URL, redirected to its new home under /projects/, /background/ or /collaborate/
migration/hugo-map.json  every Hugo file and where it went
```

## Events and registration

The 13 November 2026 get-together page is `src/content/docs/events/2026-11-13-london.mdx`.

**Adding talks.** Copy `src/content/talks/_example.md` to a new file, fill in the title, speaker, affiliation, bio and optionally a headshot (put the image in `src/content/talks/headshots/`), and set `published: true`. Until at least one talk is published, the page shows "Programme to be announced".

**How registration works** is described in the [Events&I README](eventsandeye/README.md): double opt-in, holds, waiting lists that only move when an admin clicks **Promote**, self-service changes, calendar invitations and host lists. For this event:

- **Places:** 20 in person (remote unlimited), and 6 on each lab tour. The main registration deadline is 6 November 23:59; each tour can be booked or changed until it starts, while places remain. Change any of these on the admin page.
- **Sessions:** 10:30 and 11:15 lab tours (optional, booked separately), 12:00 and 14:00 talks (in person and on Google Meet), 17:00 pub. Add the two Meet links, hosts and final times on the admin page under **Sessions**; people whose calendar entries change get an update automatically, and nobody else is emailed.
- **Calendars:** in-person attendees get one entry for their day, remote attendees one per online talk session, each with reminders and add-to-calendar links.
- **Hosts:** a session with a host email gets the attendee list whenever it changes (names, plus emails of people who opted in to share them).

**The automatic emails** are: confirm your email; a reminder with joining instructions for anyone who registers twice; joining instructions with calendar invitations on confirmation or promotion; calendar updates only when someone's entries change; cancellation confirmation; notifications to the organisers' mailbox (`NOTIFY_EMAIL` in `wrangler.toml`); host lists. Editing a page or saving new joining instructions never emails anyone.

**Admin page:** [amybo.org/admin/rsvps](https://amybo.org/admin/rsvps/), behind Cloudflare Access. It shows counts and every registration, and lets you:

- change the in-person maximum, registration deadline and assumed travel time
- edit sessions: times, location, Google Meet links, hosts, capacities and tour booking deadlines
- promote people from waiting lists, or remove spam
- download a CSV, or copy a BCC list for sending from Gmail (always paste into BCC, never To or CC)
- save a new version of the joining instructions, which new registrants then receive
- email all confirmed registrants, or a filtered group (in person or remote, a tour, people on an older joining-instructions version), now or at a scheduled time, and cancel a scheduled email
- download the **sent log** as markdown: every joining-instructions version, who has which version, the sessions, and every message sent

**Updating joining instructions without spamming anyone.** Download the sent log and ask Claude to draft the next version plus a short "what's changed" message. Save the new version, then send the "what's changed" message to *people on an older version*, ticking *counts as joining instructions version N*. Everyone ends up with everything, and nobody gets the same information twice.

**Data retention.** A scheduled job deletes the event's registrations, their email records and host lists 30 days after the event ends. See the [privacy notice](https://amybo.org/privacy/).

## Setting up Cloudflare (first deploy)

You need a Cloudflare account with the amybo.org zone (already there, since DNS is on Cloudflare), and admin rights on the amy-bo GitHub organisation.

1. **Create the database.**

   ```sh
   npx wrangler login
   npx wrangler d1 create amybo-rsvp
   ```

   Put the printed `database_id` into both `wrangler.toml` and `workers/cron/wrangler.toml`, commit, then create the tables and the 13 November event:

   ```sh
   npx wrangler d1 migrations apply amybo-rsvp --remote
   npx wrangler d1 execute amybo-rsvp --remote --file seed/2026-11-13-london.sql
   ```

2. **Connect GitHub.** In the Cloudflare dashboard: Workers & Pages → Create → Pages → Connect to Git. When GitHub asks, install the Cloudflare Pages app on the **amy-bo** organisation and give it access to **only** the `website` repository. Choose `amy-bo/website`, production branch `main`, framework preset Astro, build command `npm run build`, output directory `dist`. Add the build variable `NODE_VERSION` = `22`. Pages reads the D1 binding and variables from `wrangler.toml`.

3. **Turnstile.** Dashboard → Turnstile → Add widget for `amybo.org` (and `amybo.pages.dev` for previews), managed mode. Add the **site key** as the Pages build variable `PUBLIC_TURNSTILE_SITE_KEY` (the build fails without it, so a test key can never reach the live site), and the **secret key** as the secret `TURNSTILE_SECRET_KEY`.

4. **Resend.** In Resend, add the domain `amybo.org`. Resend shows a few DNS records (an MX and a TXT record on a `send` subdomain, and a DKIM TXT record). Add them in Cloudflare DNS with the proxy **off** (DNS only), then click Verify in Resend. These records sit on subdomains, so the existing Google mail for the domain keeps working. Create an API key with **sending access** only.

5. **Secrets.** In the Pages project → Settings → Variables and secrets, for Production (and Preview if you use previews):

   | Secret | Value |
   | --- | --- |
   | `TOKEN_SECRET` | output of `openssl rand -hex 32`; keep it stable, because changing it breaks every link already emailed |
   | `RESEND_API_KEY` | the Resend key |
   | `TURNSTILE_SECRET_KEY` | the Turnstile secret key |

   Never set `DEV_MODE` on Cloudflare.

6. **Cloudflare Access for the admin page.** Zero Trust → Access → Applications → Add → Self-hosted. Add these destinations: `amybo.org/admin/*`, `amybo.org/api/admin/*`, `www.amybo.org/admin/*`, `www.amybo.org/api/admin/*`, `*.amybo.pages.dev/admin/*` and `*.amybo.pages.dev/api/admin/*`. Add a policy *Allow* for the admins' email addresses (one-time PIN login works without any extra setup). Save, then copy the application's **Audience (AUD) tag** into `ACCESS_AUD` in `wrangler.toml`, and your team domain (Zero Trust → Settings → Custom pages, e.g. `amybo.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`. Commit and push. The functions refuse admin requests without a valid Access token even if the Access policy is misconfigured.

7. **Cron Worker.** Deploy the scheduled-jobs Worker and give it the same secrets:

   ```sh
   npx wrangler deploy --config workers/cron/wrangler.toml
   npx wrangler secret put TOKEN_SECRET --config workers/cron/wrangler.toml
   npx wrangler secret put RESEND_API_KEY --config workers/cron/wrangler.toml
   ```

8. **Test on the preview URL** (`https://amybo.pages.dev`): register with your own email, confirm, change and cancel; open `/admin/rsvps/` and check it asks you to log in.

Local development of the functions: copy `.dev.vars.example` to `.dev.vars`, fill in `TOKEN_SECRET`, then `npm run build && npm run db:migrate:local && npm run pages:dev` and open http://localhost:8788. Emails, including calendar attachments, are printed to the console and stored in a local outbox instead of being sent.

## Cut-over from Netlify to Cloudflare Pages

- [ ] Steps 1 to 8 above done, and the preview site checked page by page against the live site (REVIEW.md lists every page).
- [ ] Event page facts confirmed: times, room and entrance, in-person maximum, tour capacities and registration deadline (set on the admin page).
- [ ] Joining instructions version 1 checked on the admin page, including the Google Meet link and room details (or a note that they will follow).
- [ ] Resend domain shows **Verified**; a test registration email arrives and is not in spam.
- [ ] **Gate, not a tick-box:** calendar invitations checked with real sends to a Gmail and an Outlook address. The invitation shows as an invitation (check the raw message has `Content-Type: text/calendar; method=REQUEST`), adds to the calendar, and a session time change produces an update rather than a duplicate. If Outlook only shows a file, tell andeye before opening registration.
- [ ] Session hosts, the two Google Meet links and final times entered on the admin page.
- [ ] In Pages → Custom domains, add `amybo.org` and `www.amybo.org`. Cloudflare replaces the existing DNS records that point at Netlify. Wait for the certificate to show Active.
- [ ] Check https://amybo.org, a few old URLs (for example `/docs/overview/`, `/docs/pioflo/pioflo-v0.01/`, `/about/`), the event page, registration end to end, and that `/admin/rsvps/` needs a login.
- [ ] In Netlify, remove the custom domain from the old site, then delete or disable the site so it stops building.
- [ ] Archive the `amy-bo/pages` repository with a README note pointing to `amy-bo/website`.
- [ ] Update links that point at the old repository (forum, YouTube descriptions, GitHub organisation profile).

**Rollback:** in Cloudflare DNS, point `amybo.org` back at the Netlify site (the Netlify site keeps working until it is deleted), so do not delete it until the new site has run cleanly for a while.

## Changes

Done work is logged in [CHANGELOG.md](CHANGELOG.md); what remains is in [TODO.md](TODO.md).

## Licence

Website code MIT ([LICENSE](LICENSE)); Events&I in `eventsandeye/` AGPL-3.0; page text CC BY 4.0; AMYBO photos and images CC BY-SA 4.0. Details in [LICENSE-CONTENT.md](LICENSE-CONTENT.md).
