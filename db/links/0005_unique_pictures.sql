-- 3 October 2026, Martin: every picture unique; real logos; generic symbols for Socials and Stuff; the contact form
-- headed "Contact Martin" (contact.andeye.com reads `heading` once the andeye.com session adds it). Runs once.
UPDATE lp_nodes SET icon = CASE
		WHEN kind = 'group' AND label LIKE 'AMYBO%' THEN 'amybo-dark'
		WHEN kind = 'group' AND label LIKE 'andeye%' THEN 'andeye'
		WHEN kind = 'group' AND label LIKE 'Aqueum%' THEN 'aqueum'
		WHEN kind = 'group' AND label = 'Stuff' THEN 'stuff'
		WHEN kind = 'group' AND label = 'Socials' THEN 'people'
		WHEN slug = 'amybo' THEN 'amybo'
		WHEN slug = 'andeye' THEN 'andeye-inv'
		WHEN slug = 'andeye-photo' THEN 'camera'
		WHEN slug = 'aqueum' THEN 'aqueum-q'
		WHEN slug = 'aqueum-cv' THEN 'cv'
		ELSE icon END
WHERE person_id = (SELECT id FROM lp_people WHERE handle = 'martin')
  AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'martin-pictures-v2');
UPDATE lp_nodes SET url = 'https://contact.andeye.com/?source=amy.bo&heading=Contact%20Martin&subject=Message%20for%20Martin%20Currie'
WHERE slug = 'email' AND url LIKE 'https://contact.andeye.com/%' AND person_id = (SELECT id FROM lp_people WHERE handle = 'martin')
  AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'martin-pictures-v2');
INSERT OR IGNORE INTO lp_seeds (name) VALUES ('martin-pictures-v2');

-- AMYBO's page: its centre is the AMYBO logo, so its website link wears the light-on-dark one. The contact form's
-- source must be a bare hostname, or the form ignores it.
UPDATE lp_nodes SET icon = 'amybo-dark' WHERE slug = 'website' AND person_id = (SELECT id FROM lp_people WHERE handle = 'amybo')
  AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-pictures-v2');
UPDATE lp_nodes SET url = replace(url, 'source=amy.bo%2F~amybo', 'source=amy.bo') WHERE slug = 'contact' AND person_id = (SELECT id FROM lp_people WHERE handle = 'amybo')
  AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'amybo-pictures-v2');
INSERT OR IGNORE INTO lp_seeds (name) VALUES ('amybo-pictures-v2');
