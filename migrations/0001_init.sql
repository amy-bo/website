-- AMYBO events and RSVP schema (Cloudflare D1 / SQLite).
-- All timestamps are ISO 8601 UTC strings.

CREATE TABLE events (
  id              TEXT PRIMARY KEY,           -- e.g. '2026-11-13-london'
  title           TEXT NOT NULL,
  starts_at       TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  in_person_max   INTEGER NOT NULL,           -- editable from the admin page
  deadline        TEXT NOT NULL,              -- registration deadline, editable from the admin page
  page_path       TEXT NOT NULL,              -- public event page path, used in emails
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE tours (
  id          TEXT PRIMARY KEY,               -- e.g. '2026-11-13-london-1030'
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,                  -- e.g. '10:30 lab tour'
  starts_at   TEXT NOT NULL,
  capacity    INTEGER NOT NULL,               -- editable from the admin page
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE registrations (
  id                    TEXT PRIMARY KEY,     -- random; links carry id + HMAC(TOKEN_SECRET), see server/tokens.ts
  event_id              TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  attendance            TEXT NOT NULL CHECK (attendance IN ('in_person','remote')),
  affiliation           TEXT,
  needs                 TEXT,                 -- dietary or access needs
  status                TEXT NOT NULL CHECK (status IN ('pending','confirmed')),
  place                 TEXT CHECK (place IN ('place','waitlist')),        -- in-person only; NULL for remote
  tour_id               TEXT REFERENCES tours(id) ON DELETE SET NULL,      -- NULL = no tour
  tour_place            TEXT CHECK (tour_place IN ('place','waitlist')),
  consent_at            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  confirmed_at          TEXT,
  hold_expires_at       TEXT,                 -- pending registrations are deleted after this
  hold_warned_at        TEXT,                 -- when hello@ was told the hold is half used
  waitlist_since        TEXT,
  tour_waitlist_since   TEXT,
  instructions_version  INTEGER NOT NULL DEFAULT 0,  -- last joining-instructions version this person received
  UNIQUE (event_id, email)
);
CREATE INDEX registrations_event_status ON registrations (event_id, status);

-- Joining instructions, versioned. The newest version is sent to each person on confirmation or promotion.
CREATE TABLE instructions (
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  subject      TEXT NOT NULL,
  body_md      TEXT NOT NULL,                 -- markdown; rendered to HTML and text when sent
  change_note  TEXT,                          -- what changed since the previous version
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  PRIMARY KEY (event_id, version)
);

-- Everything sent to registrants by an admin, now or scheduled. Personal data lives only in deliveries.
CREATE TABLE messages (
  id                    TEXT PRIMARY KEY,
  event_id              TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  subject               TEXT NOT NULL,
  body_md               TEXT NOT NULL,
  audience              TEXT NOT NULL,        -- JSON filter, see server/rsvp.ts audienceWhere()
  marks_instructions_version INTEGER,         -- if set, recipients are recorded as having this instructions version
  status                TEXT NOT NULL CHECK (status IN ('scheduled','sending','sent','cancelled','failed')),
  scheduled_at          TEXT,                 -- NULL = send immediately
  sent_at               TEXT,
  recipients_count      INTEGER,
  error                 TEXT,
  created_at            TEXT NOT NULL,
  created_by            TEXT
);

-- Per-recipient record of automatic and admin emails. Deleted with the registration.
CREATE TABLE deliveries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,             -- 'confirm_email','instructions','message','cancellation'
  message_id       TEXT,
  instructions_version INTEGER,
  sent_at          TEXT NOT NULL,
  provider_id      TEXT
);

-- Local development only: emails are written here (and to the console) instead of being sent.
CREATE TABLE dev_outbox (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr   TEXT NOT NULL,
  subject   TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- The London get-together, 13 November 2026 (Europe/London = UTC in November).
INSERT INTO events (id, title, starts_at, ends_at, in_person_max, deadline, page_path) VALUES
  ('2026-11-13-london', 'AMYBO get-together, London', '2026-11-13T10:30:00Z', '2026-11-13T22:00:00Z', 40, '2026-11-06T23:59:00Z', '/events/2026-11-13-london/');

INSERT INTO tours (id, event_id, label, starts_at, capacity, sort) VALUES
  ('2026-11-13-london-1030', '2026-11-13-london', '10:30 lab tour', '2026-11-13T10:30:00Z', 10, 1),
  ('2026-11-13-london-1115', '2026-11-13-london', '11:15 lab tour', '2026-11-13T11:15:00Z', 10, 2);

INSERT INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES
  ('2026-11-13-london', 1, 'Joining instructions: AMYBO get-together, 13 November 2026',
'Thank you for registering for the AMYBO get-together on **Friday 13 November 2026**.

**Where:** Bezos Centre for Sustainable Protein, Imperial College White City campus, 84 Wood Lane, London W12 0BZ. Room and entrance details will follow in an update before the day.

**Getting there:** Wood Lane station (Hammersmith & City and Circle lines) is a few minutes'' walk away.

**Draft schedule (times to be confirmed):**

- 10:30 Arrival and coffee, first optional lab tour
- 11:15 Second optional lab tour and networking
- 12:00 Welcome and talks
- 13:00 Lunch
- 14:00 Talks and discussion
- 16:30 Close
- 17:00 Pub and dinner

**Food:** attendance is free. Unless a sponsor comes forward, please buy your own lunch and dinner. The Works (Sir Michael Uren Hub, on campus) is close for lunch; we plan to go to The Broadcaster (89 Wood Lane) afterwards.

**Joining remotely:** the talks will be available on Google Meet. The link will be sent in an update before the day.

To change or cancel your registration, use your personal link below.', 'First version', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'setup');
