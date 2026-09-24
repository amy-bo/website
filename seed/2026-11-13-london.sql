-- AMYBO get-together, London, Friday 13 November 2026 (Europe/London = UTC in November).
-- Apply once after the Events&I migrations:  npx wrangler d1 execute amybo-rsvp --remote --file seed/2026-11-13-london.sql
-- Numbers, deadlines, links and hosts are all editable later from /admin/rsvps/.

INSERT INTO events (id, title, starts_at, ends_at, timezone, location, in_person_max, deadline, travel_minutes, page_path) VALUES
  ('2026-11-13-london', 'AMYBO get-together, London', '2026-11-13T10:30:00Z', '2026-11-13T22:00:00Z', 'Europe/London',
   'Bezos Centre for Sustainable Protein, Imperial College White City campus, 84 Wood Lane, London W12 0BZ',
   20, '2026-11-06T23:59:00Z', 60, '/events/2026-11-13-london/');

INSERT INTO sessions (id, event_id, label, kind, mode, choice_group, starts_at, ends_at, capacity, sort) VALUES
  ('2026-11-13-london-tour-1030', '2026-11-13-london', '10:30 lab tour', 'tour', 'in_person', 'tour', '2026-11-13T10:30:00Z', '2026-11-13T11:15:00Z', 6, 1),
  ('2026-11-13-london-tour-1115', '2026-11-13-london', '11:15 lab tour', 'tour', 'in_person', 'tour', '2026-11-13T11:15:00Z', '2026-11-13T12:00:00Z', 6, 2),
  ('2026-11-13-london-talks-am', '2026-11-13-london', 'Welcome and talks', 'talk', 'hybrid', NULL, '2026-11-13T12:00:00Z', '2026-11-13T13:00:00Z', NULL, 3),
  ('2026-11-13-london-talks-pm', '2026-11-13-london', 'Talks and discussion', 'talk', 'hybrid', NULL, '2026-11-13T14:00:00Z', '2026-11-13T16:30:00Z', NULL, 4),
  ('2026-11-13-london-pub', '2026-11-13-london', 'Pub and dinner', 'social', 'in_person', NULL, '2026-11-13T17:00:00Z', '2026-11-13T20:00:00Z', NULL, 5);

UPDATE sessions SET location = 'The Broadcaster, 89 Wood Lane, London' WHERE id = '2026-11-13-london-pub';

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

**Joining remotely:** the talks are on Google Meet. Your calendar entries carry the links once they are set up; we will send an update if they change.

Calendar entries are attached to this email. To change or cancel your registration, use your personal link below.', 'First version', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'setup');
