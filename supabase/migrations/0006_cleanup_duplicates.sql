-- Migration 0006 — clean up duplicate children/locations introduced by 0005
--
-- The 0005 idempotent block had a bug: its `INSERT ... ON CONFLICT DO NOTHING`
-- had no unique target, so every run created fresh rows alongside the
-- pre-existing ones. This migration:
--
--   1. Picks the OLDEST row per (household, label) for each location and per
--      (household, name) for each child as the canonical record.
--   2. Re-points every FK in pickup_slots / activities / children to the
--      canonical row.
--   3. Deletes the now-orphaned duplicates.
--   4. Updates the canonical locations with the correct addresses + notes.

do $$
declare
  h_id uuid;
  -- canonical ids
  c_yali uuid; c_liam uuid; c_adam uuid;
  loc_home uuid; loc_gan_yali uuid; loc_gan_liam uuid; loc_gan_adam uuid;
  loc_soccer uuid; loc_drahi uuid; loc_neve_tzedek uuid;
begin
  select id into h_id from households where name = 'Roditi' limit 1;

  -- ── Pick the oldest row as canonical for each (label/name) combo
  select id into loc_home from locations
    where household_id = h_id and label = 'Home' order by created_at asc limit 1;
  select id into loc_gan_yali from locations
    where household_id = h_id and label = 'Gan Yali' order by created_at asc limit 1;
  select id into loc_gan_liam from locations
    where household_id = h_id and label = 'Gan Liam' order by created_at asc limit 1;
  select id into loc_gan_adam from locations
    where household_id = h_id and label = 'Gan Adam' order by created_at asc limit 1;
  select id into loc_soccer from locations
    where household_id = h_id and label = 'Gan Meir Park' order by created_at asc limit 1;
  select id into loc_drahi from locations
    where household_id = h_id and label = 'Drahi Community Center' order by created_at asc limit 1;
  select id into loc_neve_tzedek from locations
    where household_id = h_id and label = 'Neve Tzedek Community Center' order by created_at asc limit 1;

  select id into c_yali from children where household_id = h_id and name = 'Yali' order by created_at asc limit 1;
  select id into c_liam from children where household_id = h_id and name = 'Liam' order by created_at asc limit 1;
  select id into c_adam from children where household_id = h_id and name = 'Adam' order by created_at asc limit 1;

  -- ── Re-point pickup_slots FKs to canonical IDs
  update pickup_slots set child_id = c_yali where child_id in (
    select id from children where household_id = h_id and name = 'Yali' and id <> c_yali);
  update pickup_slots set child_id = c_liam where child_id in (
    select id from children where household_id = h_id and name = 'Liam' and id <> c_liam);
  update pickup_slots set child_id = c_adam where child_id in (
    select id from children where household_id = h_id and name = 'Adam' and id <> c_adam);

  update pickup_slots set pickup_location_id = loc_home where pickup_location_id in (
    select id from locations where household_id = h_id and label = 'Home' and id <> loc_home);
  update pickup_slots set destination_location_id = loc_home where destination_location_id in (
    select id from locations where household_id = h_id and label = 'Home' and id <> loc_home);
  update pickup_slots set via_location_id = loc_home where via_location_id in (
    select id from locations where household_id = h_id and label = 'Home' and id <> loc_home);

  update pickup_slots set pickup_location_id = loc_gan_yali where pickup_location_id in (
    select id from locations where household_id = h_id and label = 'Gan Yali' and id <> loc_gan_yali);
  update pickup_slots set pickup_location_id = loc_gan_liam where pickup_location_id in (
    select id from locations where household_id = h_id and label = 'Gan Liam' and id <> loc_gan_liam);
  update pickup_slots set pickup_location_id = loc_gan_adam where pickup_location_id in (
    select id from locations where household_id = h_id and label = 'Gan Adam' and id <> loc_gan_adam);

  update pickup_slots set destination_location_id = loc_soccer where destination_location_id in (
    select id from locations where household_id = h_id and label = 'Gan Meir Park' and id <> loc_soccer);
  update pickup_slots set via_location_id = loc_soccer where via_location_id in (
    select id from locations where household_id = h_id and label = 'Gan Meir Park' and id <> loc_soccer);

  update pickup_slots set destination_location_id = loc_drahi where destination_location_id in (
    select id from locations where household_id = h_id and label = 'Drahi Community Center' and id <> loc_drahi);
  update pickup_slots set via_location_id = loc_drahi where via_location_id in (
    select id from locations where household_id = h_id and label = 'Drahi Community Center' and id <> loc_drahi);

  update pickup_slots set destination_location_id = loc_neve_tzedek where destination_location_id in (
    select id from locations where household_id = h_id and label = 'Neve Tzedek Community Center' and id <> loc_neve_tzedek);
  update pickup_slots set via_location_id = loc_neve_tzedek where via_location_id in (
    select id from locations where household_id = h_id and label = 'Neve Tzedek Community Center' and id <> loc_neve_tzedek);

  -- ── Re-point activities FKs to canonical IDs
  update activities set child_id = c_yali where child_id in (
    select id from children where household_id = h_id and name = 'Yali' and id <> c_yali);
  update activities set child_id = c_liam where child_id in (
    select id from children where household_id = h_id and name = 'Liam' and id <> c_liam);
  update activities set child_id = c_adam where child_id in (
    select id from children where household_id = h_id and name = 'Adam' and id <> c_adam);

  update activities set default_pickup_location_id = loc_gan_yali where default_pickup_location_id in (
    select id from locations where household_id = h_id and label = 'Gan Yali' and id <> loc_gan_yali);
  update activities set default_pickup_location_id = loc_gan_liam where default_pickup_location_id in (
    select id from locations where household_id = h_id and label = 'Gan Liam' and id <> loc_gan_liam);
  update activities set default_pickup_location_id = loc_gan_adam where default_pickup_location_id in (
    select id from locations where household_id = h_id and label = 'Gan Adam' and id <> loc_gan_adam);

  update activities set default_destination_location_id = loc_soccer where default_destination_location_id in (
    select id from locations where household_id = h_id and label = 'Gan Meir Park' and id <> loc_soccer);
  update activities set default_destination_location_id = loc_drahi where default_destination_location_id in (
    select id from locations where household_id = h_id and label = 'Drahi Community Center' and id <> loc_drahi);
  update activities set default_destination_location_id = loc_neve_tzedek where default_destination_location_id in (
    select id from locations where household_id = h_id and label = 'Neve Tzedek Community Center' and id <> loc_neve_tzedek);

  -- ── children link cleanup (point canonical children at canonical locations)
  update children set school_location_id = loc_gan_yali, home_location_id = loc_home where id = c_yali;
  update children set school_location_id = loc_gan_liam, home_location_id = loc_home where id = c_liam;
  update children set school_location_id = loc_gan_adam, home_location_id = loc_home where id = c_adam;

  -- ── delete duplicate children (those without slot references now)
  delete from children where household_id = h_id and id not in (c_yali, c_liam, c_adam);

  -- ── delete duplicate activities (keep one per (child_id, title))
  delete from activities a using activities b
    where a.child_id = b.child_id and a.title = b.title and a.created_at > b.created_at;

  -- ── delete duplicate locations
  delete from locations
    where household_id = h_id
    and id not in (loc_home, loc_gan_yali, loc_gan_liam, loc_gan_adam, loc_soccer, loc_drahi, loc_neve_tzedek)
    and label in ('Home', 'Gan Yali', 'Gan Liam', 'Gan Adam', 'Gan Meir Park', 'Drahi Community Center', 'Neve Tzedek Community Center');

  -- ── update canonical locations with the right addresses + notes
  update locations set street = 'Neve Shalom 15', city = 'Tel Aviv', country = 'IL',
    notes = null, is_common = true where id = loc_home;

  update locations set street = 'Tartzav St 25', city = 'Tel Aviv', country = 'IL',
    notes = E'Dismisses 16:00.\nGanenet: Sari +972 52-253-2439', is_common = true where id = loc_gan_yali;

  update locations set street = 'Simtat Shefer 3', city = 'Tel Aviv', country = 'IL',
    notes = E'Dismisses 16:15. Door code: 4477*\nGanenet: Mayaan +972 54-559-5477', is_common = true where id = loc_gan_liam;

  update locations set street = 'Itzhak Elhanan 11', city = 'Tel Aviv', country = 'IL',
    notes = E'Dismisses 16:30. Door code: 0852\nGanenet: Sabrin +972 50-214-5770', is_common = true where id = loc_gan_adam;

  update locations set street = 'King George St 35', city = 'Tel Aviv', country = 'IL',
    notes = E'Coach: Almog +972 50-895-3534', is_common = true where id = loc_soccer;

  update locations set street = 'Kalisher St 5', city = 'Tel Aviv', country = 'IL',
    notes = null, is_common = true where id = loc_drahi;

  update locations set street = 'Neve Shalom St 9', city = 'Tel Aviv', country = 'IL',
    notes = null, is_common = true where id = loc_neve_tzedek;

  -- ── ensure Tichon Hadash placeholder is gone if anything still points to it
  delete from locations where household_id = h_id and label like 'Tichon Hadash%';

  -- ── ensure activities are linked to canonical destinations + pickups
  update activities set default_pickup_location_id = loc_gan_liam, default_destination_location_id = loc_soccer
    where child_id = c_liam and title = 'Soccer';
  update activities set default_pickup_location_id = loc_gan_liam, default_destination_location_id = loc_drahi
    where child_id = c_liam and title = 'Judo';
  update activities set default_pickup_location_id = loc_gan_adam, default_destination_location_id = loc_drahi
    where child_id = c_adam and title = 'Ninja';
  update activities set default_pickup_location_id = loc_gan_adam, default_destination_location_id = loc_neve_tzedek
    where child_id = c_adam and title = 'Judo';

end $$;
