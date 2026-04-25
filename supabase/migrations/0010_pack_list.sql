-- Migration 0010 — backpack pack-list fields
--
-- For the evening backpack reminder. Two sources:
--
--   activities.pack_list — the recurring list per activity (e.g. "judo
--     uniform" for every judo session). Set once, reused forever.
--
--   pickup_slots.pack_notes — a per-event one-off ("fancy clothes for
--     Pesach"). Pulled from "Pack:" / "Bring:" / "Wear:" lines in the
--     Google Calendar event description by the importer.

alter table activities
  add column if not exists pack_list text;

alter table pickup_slots
  add column if not exists pack_notes text;

comment on column activities.pack_list is
  'Recurring "what to bring" reminder for this activity. Sent the evening before via cron.';
comment on column pickup_slots.pack_notes is
  'Per-event one-off pack reminder. Lifted from calendar event description (Pack:/Bring:/Wear:).';

-- Seed the obvious defaults for the Roditi family
do $$
declare
  c_yali uuid; c_liam uuid; c_adam uuid;
begin
  select id into c_yali from children where name = 'Yali' limit 1;
  select id into c_liam from children where name = 'Liam' limit 1;
  select id into c_adam from children where name = 'Adam' limit 1;

  update activities set pack_list = 'Soccer cleats, shin guards, water bottle'
    where child_id = c_liam and title = 'Soccer';
  update activities set pack_list = 'Judo uniform (gi)'
    where child_id = c_liam and title = 'Judo';
  update activities set pack_list = 'Ninja uniform / sportswear'
    where child_id = c_adam and title = 'Ninja';
  update activities set pack_list = 'Judo uniform (gi)'
    where child_id = c_adam and title = 'Judo';
end $$;
