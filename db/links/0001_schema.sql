-- Link pages (amy.bo/~name): schema. Idempotent: run on every deploy with `wrangler d1 execute --file`.
-- Privacy: link_events holds only page handle, link slug and UTC time.

CREATE TABLE IF NOT EXISTS lp_people (
	id INTEGER PRIMARY KEY,
	handle TEXT NOT NULL UNIQUE,
	email TEXT NOT NULL UNIQUE COLLATE NOCASE,
	name TEXT NOT NULL,
	bio TEXT NOT NULL DEFAULT '',
	photo TEXT NOT NULL DEFAULT '',          -- R2 key ("r2:<key>") or a site path ("/link-media/...")
	kind TEXT NOT NULL DEFAULT 'person',     -- 'person' or 'org' (org: logo instead of a round photo)
	basic_mode INTEGER NOT NULL DEFAULT 0,   -- 1: list only, no graph
	diary_default TEXT NOT NULL DEFAULT 'all', -- 'all' or 'highlights'
	status TEXT NOT NULL DEFAULT 'invited',  -- 'invited', 'active', 'disabled'
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
	last_sign_in TEXT
);

-- Everything on a page is a node in one tree: groups, links, the diary and the support note.
CREATE TABLE IF NOT EXISTS lp_nodes (
	id INTEGER PRIMARY KEY,
	person_id INTEGER NOT NULL REFERENCES lp_people(id) ON DELETE CASCADE,
	parent_id INTEGER REFERENCES lp_nodes(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,                      -- 'group', 'link', 'diary', 'support'
	slug TEXT NOT NULL,                      -- stable per person; used in /go/<slug> and the stats
	label TEXT NOT NULL,
	url TEXT NOT NULL DEFAULT '',
	icon TEXT NOT NULL DEFAULT '',
	image TEXT NOT NULL DEFAULT '',          -- like lp_people.photo
	body TEXT NOT NULL DEFAULT '',           -- support note text
	seed INTEGER NOT NULL DEFAULT 0,         -- clicks counted elsewhere before (e.g. Linktree)
	position REAL NOT NULL DEFAULT 0,
	UNIQUE (person_id, slug)
);
CREATE INDEX IF NOT EXISTS lp_nodes_person ON lp_nodes(person_id, parent_id, position);

CREATE TABLE IF NOT EXISTS lp_diary (
	id INTEGER PRIMARY KEY,
	person_id INTEGER NOT NULL REFERENCES lp_people(id) ON DELETE CASCADE,
	day TEXT NOT NULL,                       -- YYYY-MM-DD
	title TEXT NOT NULL,
	body TEXT NOT NULL DEFAULT '',
	highlight INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS lp_diary_person_day ON lp_diary(person_id, day DESC);

-- Single-use sign-in links (invitations are sign-in links for an 'invited' person). Only hashes are stored.
CREATE TABLE IF NOT EXISTS lp_tokens (
	hash TEXT PRIMARY KEY,
	person_id INTEGER NOT NULL REFERENCES lp_people(id) ON DELETE CASCADE,
	purpose TEXT NOT NULL,                   -- 'invite' or 'signin'
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
	expires_at TEXT NOT NULL,
	used_at TEXT
);
CREATE INDEX IF NOT EXISTS lp_tokens_person ON lp_tokens(person_id, created_at);

CREATE TABLE IF NOT EXISTS lp_sessions (
	hash TEXT PRIMARY KEY,
	person_id INTEGER NOT NULL REFERENCES lp_people(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
	expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS link_events (
	id INTEGER PRIMARY KEY,
	page TEXT NOT NULL,
	slug TEXT NOT NULL,
	at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS link_events_page_slug_at ON link_events(page, slug, at);
