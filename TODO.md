# TODO

Open work on amybo.org. Done work is in [CHANGELOG.md](CHANGELOG.md). Abandoned items stay here marked `[!]` with the reason.

## Open

- [ ] **amy.bo/~martin live:** amy.bo is on Cloudflare but doesn't serve this site yet. Either add amy.bo as a custom domain on the `amybo` Pages project, or a redirect rule amy.bo/* → amybo.org/*, then check whatever amy.bo/~martin and amy.bo/~gerrit do today. Then: Martin's profile photo (initials until then), a replacement for linktr.ee/amybo.org (an amy.bo/~amybo page), and Linktree's analytics CSV export before Linktree Pro's free week ends (about 9 October).
- [ ] **Link pages as a volunteer and supporter perk:** amy.bo/~name for anyone, with an editing page (display name, URL and image per link, proposing a default image from the site) and their own click stats. Today pages are data files in `src/links/`; the long-term version needs per-person sign-in and pages stored in D1.
- [ ] **Photo credits:** Gerrit Niezen said at the 25 September meeting that many site photos are his; confirm who took each photo in `src/assets/photos/` and credit accordingly. His credit is "Gerrit Niezen", CC BY-SA (2 Oct); still open: the two venting-solenoid photos. (The Imperial lab photo of him and Teo is by Margriet Niezen-van de Goor.)
- [ ] **One origin story:** "Why AMYBO" and About both tell it (raised by Gerrit on 25 September); merge them.
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
