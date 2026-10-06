-- Events&I: ranked polls, e.g. "what shall we do on Saturday?". Registrants signed up to the poll's session rank the
-- options with a line below which they would not go, and can add their own option ("Other"), which is checked by an
-- AI model (or an organiser) before anyone else sees it.

CREATE TABLE polls (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,  -- who may vote: people signed up to this opt-in session (NULL = every confirmed registrant)
  question    TEXT NOT NULL,
  closes_at   TEXT NOT NULL,                  -- votes and suggestions are accepted until then; editable on the admin page
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE poll_options (
  id           TEXT PRIMARY KEY,
  poll_id      TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  detail       TEXT,                          -- one line of detail, e.g. price or place
  url          TEXT,                          -- organisers' options only
  status       TEXT NOT NULL CHECK (status IN ('approved','review','removed')),  -- review = waiting for an organiser
  suggested_by TEXT REFERENCES registrations(id) ON DELETE SET NULL,            -- NULL for the organisers' options
  check_note   TEXT,                          -- why the automatic check approved it or held it for review
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX poll_options_poll ON poll_options (poll_id, status);

-- One ballot per registrant: the options in order of preference, and how many of them sit above the "wouldn't go"
-- line. Deleted with the registration (cancellation, or the 30-day retention sweep).
CREATE TABLE poll_votes (
  poll_id          TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  registration_id  TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  ranking          TEXT NOT NULL,             -- JSON array of option ids, most preferred first
  above_line       INTEGER NOT NULL,          -- the first N of ranking are ones they would go to
  show_name        INTEGER NOT NULL DEFAULT 1,-- 0 = count me, but don't show my name to other voters
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (poll_id, registration_id)
);
