# TODO

Open work on amybo.org. Done work is in [CHANGELOG.md](CHANGELOG.md). Abandoned items stay here marked `[!]` with the reason.

## Open

- [ ] **Cut over from Netlify to Cloudflare Pages.** Follow the "Setting up Cloudflare" and "Cut-over" sections of the README; the calendar-invitation check with real sends to Gmail and Outlook is a gate, not a tick-box.
- [ ] **Check the site in a real browser** at phone, tablet (1024 px) and desktop widths, light and dark: the header breakpoints, the hero over the forest photo, the dropdown menus and the registration form were reasoned about from the CSS, not seen. The axe scan runs in jsdom and cannot check colour contrast (ratios were computed by hand for Amy's palette and pass AA).
- [ ] **Event page facts** to confirm before opening registration: times, room and entrance, session hosts, the two Google Meet links, tour capacities and the registration deadline (all set on the admin page).
- [ ] **Training photos.** The side and top views of the assembled AEP 0.1 in the training README are on GitHub's image host; add them to the repository so the AEP page can use them.
- [ ] **Forum feed on Cloudflare.** The homepage fetches forum.amybo.org/latest.json at build time (src/lib/forum.mjs) and shows the six latest threads; it falls back silently when the forum is unreachable, which is always the case from the build container. Check the live list appears in the first Cloudflare build, and consider a daily rebuild (a Pages deploy hook on a cron) so it stays fresh.
- [ ] **Programme:** add talks under `src/content/talks/` once speakers have agreed to be named (announced on 28 September).
- [ ] **Radicle mirror** of amy-bo/electroPioreactor is behind GitHub (last seen 15 August against a 24 September main); the Projects page links it as a mirror.
- [ ] **docs.electropioreactor.org**: the AEP 0.2 guide is linked as in progress; confirm the URL scheme for MEP (and BAEP, if that is a variant) before adding links.
- [ ] **Archive amy-bo/pages** with a pointer to this repository once the new site is live, and update links on the forum, YouTube and the GitHub organisation profile.
- [ ] **Events&I as a dependency** instead of the in-repo copy, once it is published (see `eventsandeye/TODO.md`).
- [ ] **Search-engine registration:** submit the sitemap in Google Search Console and Bing Webmaster Tools after cut-over, and check the Event rich result with Google's Rich Results Test.
