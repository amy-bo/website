-- Martin's page: his own logos (andeye, Aqueum) instead of generic icons, 2 October 2026. Runs once.
UPDATE lp_nodes SET icon = 'andeye'
WHERE icon IN ('software', 'camera') AND person_id = (SELECT id FROM lp_people WHERE handle = 'martin')
  AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'martin-logos-v1');
UPDATE lp_nodes SET icon = 'aqueum'
WHERE icon IN ('water', 'cv') AND person_id = (SELECT id FROM lp_people WHERE handle = 'martin')
  AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'martin-logos-v1');
INSERT OR IGNORE INTO lp_seeds (name) VALUES ('martin-logos-v1');
