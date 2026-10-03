-- Link pages, 3 October 2026: per-item picture colour and size, a page tint, and Martin's Email group made a plain link.
-- Separate tables (rather than new columns) so this file stays safe to run on every deploy.
CREATE TABLE IF NOT EXISTS lp_node_style (
	node_id INTEGER PRIMARY KEY REFERENCES lp_nodes(id) ON DELETE CASCADE,
	tint TEXT NOT NULL DEFAULT '',   -- '' original colours, 'mono' the page's ink, or '#rrggbb'
	zoom REAL NOT NULL DEFAULT 1     -- picture size within its circle, 0.6 to 2.4
);
CREATE TABLE IF NOT EXISTS lp_page_style (
	person_id INTEGER PRIMARY KEY REFERENCES lp_people(id) ON DELETE CASCADE,
	accent TEXT NOT NULL DEFAULT ''  -- '' AMYBO green, or '#rrggbb'
);

-- Martin's "Email" group held one link; it becomes that link, named Email, where the group was. Runs once.
UPDATE lp_nodes SET parent_id = NULL, label = 'Email',
	position = (SELECT g.position FROM lp_nodes g WHERE g.id = lp_nodes.parent_id)
WHERE slug = 'email' AND person_id = (SELECT id FROM lp_people WHERE handle = 'martin')
  AND parent_id IN (SELECT id FROM lp_nodes WHERE kind = 'group' AND label = 'Email')
  AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'martin-email-link-v1');
DELETE FROM lp_nodes WHERE kind = 'group' AND label = 'Email' AND person_id = (SELECT id FROM lp_people WHERE handle = 'martin')
  AND NOT EXISTS (SELECT 1 FROM lp_nodes c WHERE c.parent_id = lp_nodes.id)
  AND NOT EXISTS (SELECT 1 FROM lp_seeds WHERE name = 'martin-email-link-v1');
INSERT OR IGNORE INTO lp_seeds (name) VALUES ('martin-email-link-v1');
