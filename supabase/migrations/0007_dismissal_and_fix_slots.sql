-- Migration 0007 — add gan dismissal time on children, fix existing slots
--
-- Adds children.gan_dismissal_time so the calendar sync + daily defaults
-- generator know when to pick each kid up from their Gan. Then rewrites
-- existing future pickup_slots to the new model:
--
--   pickup_location_id    = child's Gan (was: activity location)
--   via_location_id       = activity location (was: pickup_location_id)
--   destination_location_id = Home (unchanged in most cases)
--   pickup_time           = child's Gan dismissal time

alter table children add column if not exists gan_dismissal_time time;

do $$
declare
  h_id uuid;
  c_yali uuid; c_liam uuid; c_adam uuid;
begin
  select id into h_id from households where name = 'Roditi' limit 1;
  select id into c_yali from children where household_id = h_id and name = 'Yali' limit 1;
  select id into c_liam from children where household_id = h_id and name = 'Liam' limit 1;
  select id into c_adam from children where household_id = h_id and name = 'Adam' limit 1;

  update children set gan_dismissal_time = '16:00' where id = c_yali;
  update children set gan_dismissal_time = '16:15' where id = c_liam;
  update children set gan_dismissal_time = '16:30' where id = c_adam;

  -- Fix existing future activity slots: their pickup is currently the activity
  -- location; rewrite to: pickup = Gan, via = activity location, time = dismissal.
  update pickup_slots ps set
    via_location_id = ps.pickup_location_id,
    pickup_location_id = c.school_location_id,
    pickup_time = c.gan_dismissal_time,
    destination_location_id = c.home_location_id
  from children c
  where ps.child_id = c.id
    and ps.date >= current_date
    and ps.activity_id is not null
    and ps.pickup_location_id is not null
    and ps.pickup_location_id <> c.school_location_id;

end $$;
