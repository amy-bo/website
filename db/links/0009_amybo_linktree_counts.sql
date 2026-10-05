-- Link pages, 5 October 2026: AMYBO's lifetime Linktree clicks per link (linktr.ee/amybo.org, read 5 October),
-- carried over as each link's starting count, as Martin's were. Runs once.
UPDATE lp_nodes SET seed = 8 WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'amybo') AND slug = 'waitlist' AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-linktree-counts-v1');
UPDATE lp_nodes SET seed = 2 WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'amybo') AND slug = 'forum' AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-linktree-counts-v1');
UPDATE lp_nodes SET seed = 1 WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'amybo') AND slug = 'youtube' AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-linktree-counts-v1');
UPDATE lp_nodes SET seed = 4 WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'amybo') AND slug = 'website' AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-linktree-counts-v1');
UPDATE lp_nodes SET seed = 6 WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'amybo') AND slug = 'github' AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-linktree-counts-v1');
UPDATE lp_nodes SET seed = 2 WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'amybo') AND slug = 'docs' AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-linktree-counts-v1');
UPDATE lp_nodes SET seed = 3 WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'amybo') AND slug = 'prints' AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-linktree-counts-v1');
UPDATE lp_nodes SET seed = 2 WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'amybo') AND slug = 'contact' AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-linktree-counts-v1');
UPDATE lp_nodes SET seed = 6 WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'amybo') AND slug = 'martin' AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-linktree-counts-v1');
UPDATE lp_nodes SET seed = 3 WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'amybo') AND slug = 'gerrit-margriet' AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-linktree-counts-v1');
INSERT OR IGNORE INTO lp_seeds (name) VALUES ('amybo-linktree-counts-v1');
