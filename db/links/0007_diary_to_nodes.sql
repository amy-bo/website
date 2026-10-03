-- Diary entries become ordinary items under the diary (with a short date and a highlight), 3 October 2026. Runs once.
-- A page with entries but no diary item gets one, at the end.
INSERT INTO lp_nodes (person_id, kind, slug, label, icon, position)
SELECT DISTINCT d.person_id, 'diary', 'diary', 'AMYBO diary', 'diary', 999 FROM lp_diary d
WHERE NOT EXISTS (SELECT 1 FROM lp_nodes n WHERE n.person_id = d.person_id AND n.kind = 'diary')
  AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'diary-to-nodes-v1');
INSERT OR IGNORE INTO lp_nodes (person_id, parent_id, kind, slug, label, body, position)
SELECT d.person_id, (SELECT n.id FROM lp_nodes n WHERE n.person_id = d.person_id AND n.kind = 'diary' ORDER BY n.id LIMIT 1),
	'text', 'entry-' || d.id, d.title, d.body, 0
FROM lp_diary d WHERE NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'diary-to-nodes-v1');
INSERT OR IGNORE INTO lp_node_meta (node_id, day, highlight)
SELECT n.id, substr(d.day, 3, 2) || substr(d.day, 6, 2) || substr(d.day, 9, 2), d.highlight
FROM lp_diary d JOIN lp_nodes n ON n.person_id = d.person_id AND n.slug = 'entry-' || d.id
WHERE NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'diary-to-nodes-v1');
INSERT OR IGNORE INTO lp_seeds (name) VALUES ('diary-to-nodes-v1');
