-- amybo.org (not Events&I): remote access to electroPioreactors (src/remote/). Kept here because this is the database's
-- one migrations directory (wrangler.toml migrations_dir). Idempotent: every statement can run again.
--
-- remote_experiments: one row per Pi people can be given access to. hostname is the Pi's public address (a Cloudflare
-- Tunnel hostname guarded by its own Cloudflare Access application, access_app_id). ends_on is the last day of the course:
-- after it nobody but the admins is let in, and 30 days after it the course's applications are deleted.
-- synced_emails: the allow list last written to (or confirmed in) the Access policy, as a sorted JSON list.
CREATE TABLE IF NOT EXISTS remote_experiments (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	hostname TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'open', 'closed')),
	offered INTEGER NOT NULL DEFAULT 1,
	ends_on TEXT,
	access_app_id TEXT,
	synced_emails TEXT,
	synced_at TEXT,
	sync_error TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- remote_applications: one per email address. status: unconfirmed (email not yet confirmed; deleted after 3 days),
-- pending (confirmed, waiting for a decision), approved (assigned to experiment_id), rejected.
CREATE TABLE IF NOT EXISTS remote_applications (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	email TEXT NOT NULL UNIQUE,
	institution TEXT NOT NULL,
	wish_experiment_id INTEGER,
	wish_text TEXT,
	reason TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (status IN ('unconfirmed', 'pending', 'approved', 'rejected')),
	experiment_id INTEGER,
	consent_at TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	confirmed_at TEXT,
	decided_at TEXT,
	access_emailed_at TEXT,
	resends INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS remote_applications_experiment ON remote_applications (experiment_id, status);
CREATE INDEX IF NOT EXISTS remote_applications_created ON remote_applications (status, created_at);

-- The Glasgow course's Pi, so the form can offer it straight away. Its address, dates and Access application are set on
-- the admin page (/admin/remote/). Inserted once; later edits on the admin page are kept.
INSERT INTO remote_experiments (name, hostname, status, offered, created_at, updated_at)
	VALUES ('Glasgow 2026', 'remote-glasgow.amybo.org', 'planned', 1, '2026-11-28T12:00:00Z', '2026-11-28T12:00:00Z')
	ON CONFLICT (hostname) DO NOTHING;
