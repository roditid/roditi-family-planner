-- Migration 0013 — pull pickup back when activity starts at/before dismissal
--
-- When the kid's normal Gan dismissal coincides with the activity start
-- (Adam dismisses 16:30, Ninja starts 16:30), collecting the kid at 16:30
-- means arriving at the activity 5–10 min late. Ganenets allow early
-- pickup when there's an activity to get to, so we shift pickup_time to
-- 15 min before the activity so the helper has transit time.
--
-- Future imports apply this rule automatically; this migration backfills
-- existing rows so today's chips are correct without a fresh sync.

update pickup_slots ps
   set pickup_time = (ps.activity_start_time::time - interval '15 minutes')::time
  from children c
 where ps.child_id = c.id
   and ps.activity_id is not null
   and ps.activity_start_time is not null
   and c.gan_dismissal_time is not null
   and ps.activity_start_time <= c.gan_dismissal_time
   and ps.date >= current_date;
