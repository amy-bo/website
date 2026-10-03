-- Link pages, 3 October 2026: per-item picture colour and size, dates and highlights, a page tint and centre picture,
-- and Martin's Email group made a plain link.
-- Separate tables (rather than new columns) so this file stays safe to run on every deploy.
CREATE TABLE IF NOT EXISTS lp_node_meta (
	node_id INTEGER PRIMARY KEY REFERENCES lp_nodes(id) ON DELETE CASCADE,
	tint TEXT NOT NULL DEFAULT '',   -- '' original colours, 'mono' the page tint, or '#rrggbb'
	zoom REAL NOT NULL DEFAULT 1,    -- picture size within its circle, 0.6 to 2.4
	day TEXT NOT NULL DEFAULT '',    -- optional short date: YY, YYMM or YYMMDD (diary entries)
	highlight INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lp_page_meta (
	person_id INTEGER PRIMARY KEY REFERENCES lp_people(id) ON DELETE CASCADE,
	accent TEXT NOT NULL DEFAULT '', -- '' AMYBO green, or '#rrggbb'
	hub_icon TEXT NOT NULL DEFAULT '', -- the centre's picture when it isn't a photo
	hub_tint TEXT NOT NULL DEFAULT '',
	hub_zoom REAL NOT NULL DEFAULT 1
);
-- A picture's dark-mode version. While linked it follows the light one; unlinking uses these, and relinking
-- keeps them for next time.
CREATE TABLE IF NOT EXISTS lp_node_dark (
	node_id INTEGER PRIMARY KEY REFERENCES lp_nodes(id) ON DELETE CASCADE,
	linked INTEGER NOT NULL DEFAULT 1,
	icon TEXT NOT NULL DEFAULT '',
	tint TEXT NOT NULL DEFAULT '',
	zoom REAL NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS lp_page_dark (
	person_id INTEGER PRIMARY KEY REFERENCES lp_people(id) ON DELETE CASCADE,
	linked INTEGER NOT NULL DEFAULT 1,
	icon TEXT NOT NULL DEFAULT '',
	tint TEXT NOT NULL DEFAULT '',
	zoom REAL NOT NULL DEFAULT 1
);
-- A picture's circle colour, for light and dark ('' = the page's own).
CREATE TABLE IF NOT EXISTS lp_node_bg (
	node_id INTEGER PRIMARY KEY REFERENCES lp_nodes(id) ON DELETE CASCADE,
	bg TEXT NOT NULL DEFAULT '',
	dk_bg TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS lp_page_bg (
	person_id INTEGER PRIMARY KEY REFERENCES lp_people(id) ON DELETE CASCADE,
	bg TEXT NOT NULL DEFAULT '',
	dk_bg TEXT NOT NULL DEFAULT ''
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
