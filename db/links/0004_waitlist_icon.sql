-- AMYBO's page: the bioreactor waitlist gets a sign-up-list icon, so it differs from "Contact us" (3 October 2026). Runs once.
UPDATE lp_nodes SET icon = 'list'
WHERE slug = 'waitlist' AND icon = 'mail' AND person_id = (SELECT id FROM lp_people WHERE handle = 'amybo')
  AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-waitlist-icon-v1');
INSERT OR IGNORE INTO lp_seeds (name) VALUES ('amybo-waitlist-icon-v1');
