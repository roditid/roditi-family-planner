-- Migration 0011 — surface the activity's actual start time + final Drahi cleanup
--
-- pickup_slots.pickup_time is when the helper picks the kid up (= the Gan
-- dismissal time). pickup_slots.end_time is when the trip wraps. Neither
-- of these tells the helper when the activity itself is happening — for
-- Soccer that's 17:00–18:30 even though they collect Liam at 16:15.
--
-- We add a separate activity_start_time and backfill it from the source
-- Google Calendar event's start_at (in the household timezone).

alter table pickup_slots
  add column if not exists activity_start_time time;

comment on column pickup_slots.activity_start_time is
  'When the activity itself starts (e.g. Soccer 17:00). Distinct from pickup_time, which is when the helper picks the kid up from the Gan.';

-- Backfill from existing calendar_events
update pickup_slots ps set activity_start_time = (
    extract(hour from ce.start_at at time zone 'Asia/Jerusalem')::text
    || ':' || lpad(extract(minute from ce.start_at at time zone 'Asia/Jerusalem')::text, 2, '0')
    || ':00'
  )::time
  from calendar_events ce
  where ps.source_event_id = ce.id
    and ps.activity_id is not null
    and ps.activity_start_time is null;

-- Final Drahi/Neve Tzedek note cleanup — the "Judo (Liam) and Ninja (Adam)
-- take place here." legacy note kept resurfacing because a stale Drahi row
-- survived the earlier dedupe (it was already linked from FK columns we
-- couldn't drop). Just blank the notes; references stay intact.
update locations set notes = null where label in ('Drahi Community Center', 'Neve Tzedek Community Center');
