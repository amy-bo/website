-- amybo.org (not Events&I): live lecture polling, src/glasgow/. Kept here because this is the database's one
-- migrations directory (wrangler.toml migrations_dir).
-- Frozen polls: the table src/glasgow/db.ts also creates on first use (the same definition), and two polls from the
-- Why lecture (25 Nov 2026, set why-2026) whose answers "Clear all" wiped on 27 Nov, restored as the totals Martin
-- recorded and frozen, so no clear touches them again. Totals only: no device, nothing personal.
--   p101-2      Cultivated Meat, Plant Based, Biomass Ferm., Precision Ferm., Insects, Other  = 3, 3, 4, 1, 1, 0
--   pnew-93b-3  Spirulina, Glasgow altProtein, May fridge sample, Other (discuss)              = 1, 7, 4, 0
-- /results uses the totals only while they fit the question (a choice with that many options). Idempotent.
CREATE TABLE IF NOT EXISTS glasgow_frozen (set_id TEXT NOT NULL, q TEXT NOT NULL, at TEXT NOT NULL, counts TEXT, PRIMARY KEY (set_id, q));
INSERT INTO glasgow_frozen (set_id, q, at, counts) VALUES
	('why-2026', 'p101-2', '2026-11-27T16:00:00Z', '[3,3,4,1,1,0]'),
	('why-2026', 'pnew-93b-3', '2026-11-27T16:00:00Z', '[1,7,4,0]')
	ON CONFLICT (set_id, q) DO UPDATE SET counts = excluded.counts;
