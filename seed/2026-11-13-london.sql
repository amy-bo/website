-- AMYBO Event, London (first called the AMYBO get-together), Friday 13 November 2026 (Europe/London = UTC in November).
-- Safe to rerun: rows are only inserted if missing (the deploy workflow runs it on every deploy). After the first run the
-- admin page (/admin/rsvps/) is the source of truth for capacities, deadlines, times and hosts; editing this file does not
-- change a live event. Host emails are deliberately not in this public file: set them on the admin page.

INSERT OR IGNORE INTO events (id, title, starts_at, ends_at, timezone, location, in_person_max, deadline, travel_minutes, page_path, extra_question) VALUES
  ('2026-11-13-london', 'AMYBO get-together, London', '2026-11-13T10:30:00Z', '2026-11-13T22:00:00Z', 'Europe/London',
   'Bezos Centre for Sustainable Protein, Imperial College White City campus, 84 Wood Lane, London W12 0BZ',
   20, '2026-11-06T12:00:00Z', 60, '/events/2026-11-13-london/',
   'Staying on for Saturday 14 November? Tell us if you would like to do something together, and what you fancy.');

INSERT OR IGNORE INTO sessions (id, event_id, label, kind, mode, choice_group, starts_at, ends_at, capacity, sort, host_name, host_email, location) VALUES
  ('2026-11-13-london-tour-1030', '2026-11-13-london', '10:30 lab tour', 'tour', 'in_person', 'tour', '2026-11-13T10:30:00Z', '2026-11-13T11:15:00Z', 10, 1, 'Amir Ayazbayev', NULL, NULL),
  ('2026-11-13-london-tour-1115', '2026-11-13-london', '11:15 lab tour', 'tour', 'in_person', 'tour', '2026-11-13T11:15:00Z', '2026-11-13T12:00:00Z', 10, 2, 'Nelly Oresharova', NULL, NULL),
  ('2026-11-13-london-talks-am', '2026-11-13-london', 'Welcome and talks', 'talk', 'hybrid', NULL, '2026-11-13T12:00:00Z', '2026-11-13T13:00:00Z', NULL, 3, NULL, NULL, NULL),
  ('2026-11-13-london-talks-pm', '2026-11-13-london', 'Talks and discussion', 'talk', 'hybrid', NULL, '2026-11-13T14:00:00Z', '2026-11-13T16:30:00Z', NULL, 4, NULL, NULL, NULL),
  ('2026-11-13-london-pub', '2026-11-13-london', 'Pub and dinner', 'social', 'in_person', NULL, '2026-11-13T17:00:00Z', '2026-11-13T20:00:00Z', NULL, 5, NULL, NULL, 'The Broadcaster, 89 Wood Lane, London');


INSERT OR IGNORE INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES
  ('2026-11-13-london', 1, 'Joining instructions: AMYBO get-together, 13 November 2026',
'Thank you for registering for the AMYBO get-together on **Friday 13 November 2026**.

**Where:** Bezos Centre for Sustainable Protein, Imperial College White City campus, 84 Wood Lane, London W12 0BZ, room 516. Entrance and visitor sign-in details will follow in an update before the day.

**Getting there:** Wood Lane station (Hammersmith & City and Circle lines) is a few minutes'' walk away.

**Schedule (UK time):**

- 10:30 Arrival, first optional lab tour
- 11:15 Second optional lab tour and networking
- 12:00 Welcome from Martin Currie, then talks
- 13:00 Lunch
- 14:00 Talks and discussion
- 16:30 Close
- 17:00 Pub and dinner

**Food:** attendance is free, and snacks and soft drinks are provided. Unless a sponsor comes forward, please buy your own lunch and dinner. The Works (Sir Michael Uren Hub, on campus) is close for lunch; we plan to go to The Broadcaster (89 Wood Lane) afterwards.

**Joining remotely:** the talks are on Google Meet, and they are recorded. Your calendar entries carry the links once they are set up; we will send an update if they change.

Calendar entries are attached to this email. To change or cancel your registration, use your personal link below.', 'First version', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'setup');

-- 2 October 2026: dinner becomes an opt-in session so numbers are known before booking. Runs once (optin = 0 guard),
-- so later edits on the admin page are not overwritten.
UPDATE sessions SET optin = 1, label = 'Dinner', location = 'The Broadcaster, 89 Wood Lane, London (to be booked)'
  WHERE id = '2026-11-13-london-pub' AND optin = 0;

-- Joining instructions version 2: room 516, in-person and remote sections, dinner sign-up. Insert-only.
INSERT OR IGNORE INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES
  ('2026-11-13-london', 2, 'Joining instructions: AMYBO get-together, 13 November 2026',
':::in-person
**Where:** Room 516, Bezos Centre for Sustainable Protein, Imperial College White City campus, 84 Wood Lane, London W12 0BZ. Entrance and visitor sign-in details will follow before the day.

**Getting there:** Wood Lane station (Hammersmith & City and Circle lines) is a few minutes'' walk away, and White City station (Central line) is also close.

**Schedule (UK time):**

- 10:30 First optional lab tour
- 11:15 Second optional lab tour, and networking
- 12:00 Welcome and talks
- 13:00 Lunch
- 14:00 Talks and discussion
- 16:30 Close
- 17:00 Dinner, for those who signed up

If you booked the 10:30 tour, please arrive by 10:20. Closed shoes are needed in the labs.

**Food:** attendance is free, and snacks and soft drinks are provided. Unless a sponsor comes forward, please buy or bring your own meals. The Works (Sir Michael Uren Hub, on campus) serves hot food at lunchtime. For dinner, we will try to book The Broadcaster (89 Wood Lane) for everyone who has signed up by 12 noon on Friday 6 November; you can sign up or change your mind with your personal link below.
:::

:::remote
**Joining remotely:** the talks are on Google Meet from 12:00 to 13:00 and from 14:00 to 16:30 (UK time), and they are recorded. Your calendar entries carry the links once they are set up, and we will send an update if they change.
:::

Calendar entries are attached to this email. To change or cancel your registration, use your personal link below.', 'Room 516, separate in-person and remote sections, dinner sign-up', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'setup');

-- 5 October 2026: the event is renamed "AMYBO Event, London", and the dinner sign-up shows the likely price. Each runs
-- once (only while the old value is still there), so later edits on the admin page are not overwritten.
UPDATE events SET title = 'AMYBO Event, London' WHERE id = '2026-11-13-london' AND title = 'AMYBO get-together, London';
UPDATE sessions SET location = 'The Broadcaster, 89 Wood Lane, London (~£45 a head, to be booked)'
  WHERE id = '2026-11-13-london-pub' AND location = 'The Broadcaster, 89 Wood Lane, London (to be booked)';

-- Joining instructions version 3 (5 October): the event is now "AMYBO Event"; lunch 13:30, talks again 14:30; dinner about £45. Insert-only.
INSERT OR IGNORE INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES
  ('2026-11-13-london', 3, 'Joining instructions: AMYBO Event, 13 November 2026',
':::in-person
**Where:** Room 516, Bezos Centre for Sustainable Protein, Imperial College White City campus, 84 Wood Lane, London W12 0BZ. Entrance and visitor sign-in details will follow before the day.

**Getting there:** Wood Lane station (Hammersmith & City and Circle lines) is a few minutes'' walk away, and White City station (Central line) is also close.

**Schedule (UK time):**

- 10:30 First optional lab tour
- 11:15 Second optional lab tour, and networking
- 12:00 Welcome and talks
- 13:30 Lunch
- 14:30 Talks and discussion
- 16:30 Close
- 17:00 Dinner, for those who signed up

If you booked the 10:30 tour, please arrive by 10:20. Closed shoes are needed in the labs.

**Food:** attendance is free, and snacks and soft drinks are provided. Unless a sponsor comes forward, please buy or bring your own meals. The Works (Sir Michael Uren Hub, on campus) serves hot food at lunchtime. For dinner, we will try to book a private space at The Broadcaster (89 Wood Lane) for everyone who has signed up by 12 noon on Friday 6 November, at about £45 a head, paid on the night. We pay a £250 deposit, so please tell us as soon as you can if you can''t make it; you can sign up or change your mind with your personal link below.
:::

:::remote
**Joining remotely:** the talks are on Google Meet from 12:00 to 13:30 and from 14:30 to 16:30 (UK time), and they are recorded. Your calendar entries carry the links once they are set up, and we will send an update if they change.
:::

Calendar entries are attached to this email. To change or cancel your registration, use your personal link below.', 'New name (AMYBO Event); lunch 13:30, talks resume 14:30; dinner about £45 a head', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'setup');
