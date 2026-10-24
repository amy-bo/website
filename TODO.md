# TODO

Open work on amybo.org. Done work is in [CHANGELOG.md](CHANGELOG.md). Abandoned items stay here marked `[!]` with the reason.

## Open

- [ ] **Dinner joining instructions (Martin):** v5 joining instructions (Hawk's Nest, 17:30) have gone only to people who confirmed after 23 October; earlier registrants still hold v4 (The Broadcaster, 17:00) and a Broadcaster calendar entry. Send everyone a message including the latest joining instructions before 6 November. Also check on the admin page how many had ticked dinner before the cap of 10 went in.
- [ ] **Tour hosts named in public:** the seed names the tour hosts (Amir Ayazbayev, Nelly Oresharova) in a public file; confirm they are happy to be named, or replace with NULL and set names on the admin page.
- [ ] **Astro 7 upgrade:** npm audit reports a critical advisory on astro 5.18 (XSS and AVIF image-optimisation issues, mostly not applicable to a static build; images are only our own). Upgrade astro and Starlight 0.34 → 0.42 together; until then this is an accepted risk.

- [ ] **Link pages: shake to undo on phones** — Back already retraces map moves; shake needs DeviceMotion permission on iOS (a tap to allow), so it wants a small opt-in.

- [ ] **"Contact Martin" heading on the contact form:** contact.andeye.com should read a `heading` parameter (brief in brain2 andeye/contact-form-links, 3 October); amy.bo/~martin already sends it.
- [ ] **amy.bo/~martin and amy.bo/links live:** switch on the `amybo-redirects` Worker from `workers/amy-bo/` (repository variable `DEPLOY_AMYBO_WORKER=true` plus Workers Routes edit on amy.bo for the deploy token, or paste it into the dashboard); it adds the `www.amy.bo/*` route (www currently times out at old AWS addresses). Delete the disabled "Redirect amy.bo to amybo.org" rule. Set Martin's real sign-in email on /admin/links/ (seeded as a placeholder). Export Linktree's analytics CSV before about 9 October. Gate: switch the Worker on only after `curl -I https://amybo-4p1.pages.dev/~martin/` returns 200 with a `content-security-policy` header (the Pages Functions routes currently answer 404 on that host).
- [ ] **Link pages: image uploads.** Create the R2 bucket `amybo-links` (EU jurisdiction) and give the deploy token R2 read; the next deploy binds it. Then invite the first volunteers from /admin/links/.
- [ ] **Link pages on their own origin:** volunteers' pages are also served at amybo.org/~name, the same origin as the editor's session and the Access-protected admin. A CSP hash (only the map loader may run inline) mitigates this; once amy.bo serves the pages, redirect amybo.org/~* and /links (not /links/edit or /links/media) to amy.bo so user content never shares an origin with sign-ins.
- [ ] **Link pages: taking payment from supporters** (Martin, 2 Oct): optional, and a supporter's giving can stay entirely private.
- [ ] **Photo credits:** Gerrit Niezen said at the 25 September meeting that many site photos are his; confirm who took each photo in `src/assets/photos/` and credit accordingly. His credit is "Gerrit Niezen", CC BY-SA (2 Oct); still open: the two venting-solenoid photos. (The Imperial lab photo of him and Teo is by Margriet Niezen-van de Goor.)
- [ ] **Rewrite pushed history** (needs Martin's force-push approval): eight photos with GPS in f167580 and the Termly screenshot (src/content/docs/collaborate/safety-and-legal/Xnip2023-07-06_16-30-59.png, unused) are in pushed history; also fixes the attribution trailer on bf0e81e. Then ask GitHub Support to purge PR #1's cached refs, and check the old Hugo site's copies of the photos.
- [ ] **Delete the old North America database** `amybo-rsvp`: the EU one (`amybo-rsvp-eu`) went live with the 1 October deploy, so the old one (seed rows only) can go once registration is tested.
- [ ] **Two-factor on every login in the README table** (Cloudflare members, amy-bo GitHub organisation, Resend, the hello@amybo.org Google account) and MFA on the Access policy.
- [ ] **Cut over from Netlify to Cloudflare Pages.** Follow the "Setting up Cloudflare" and "Cut-over" sections of the README; the calendar-invitation check with real sends to Gmail and Outlook is a gate, not a tick-box.
- [ ] **Check the site in a real browser** at phone, tablet (1024 px) and desktop widths, light and dark: the header breakpoints, the hero over the forest photo, the dropdown menus and the registration form were reasoned about from the CSS, not seen. The axe scan runs in jsdom and cannot check colour contrast (ratios were computed by hand for Amy's palette and pass AA).
- [ ] **Tour host emails.** The seed names the hosts (Amir Ayazbayev, Nelly Oresharova) but keeps their emails out of the public repository; enter them on the admin page once Cloudflare Access is set up, so the host lists go out.
- [ ] **Event page facts** to confirm before opening registration: times, room and entrance, session hosts, the two Google Meet links, tour capacities and the registration deadline (all set on the admin page).
- [ ] **Training photos.** The side and top views of the assembled AEP 0.1 in the training README are on GitHub's image host; add them to the repository so the AEP page can use them.
- [ ] **Forum feed on Cloudflare.** The homepage fetches forum.amybo.org/latest.json at build time (src/lib/forum.mjs) and shows the six latest threads; it falls back silently when the forum is unreachable, which is always the case from the build container. Check the live list appears in the first Cloudflare build, and consider a daily rebuild (a Pages deploy hook on a cron) so it stays fresh.
- [ ] **Programme:** add talks under `src/content/talks/` once speakers have agreed to be named (announced on 28 September).
- [ ] **Radicle mirror** of amy-bo/electroPioreactor is behind GitHub (last seen 15 August against a 24 September main); the Projects page links it as a mirror.
- [ ] **docs.electropioreactor.org**: the AEP 0.2 guide is linked as in progress; confirm the URL scheme for MEP (and BAEP, if that is a variant) before adding links.
- [ ] **Archive amy-bo/pages** with a pointer to this repository once the new site is live, and update links on the forum, YouTube and the GitHub organisation profile.
- [ ] **Events&I as a dependency** instead of the in-repo copy, once it is published (see `eventsandeye/TODO.md`).
- [ ] **Search-engine registration:** submit the sitemap in Google Search Console and Bing Webmaster Tools after cut-over, and check the Event rich result with Google's Rich Results Test.
