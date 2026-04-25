-- Migration 0005 — seed real Roditi-family locations, children, activities
--
-- Idempotent: safe to re-run. Looks up the household by name="Roditi" and
-- upserts each entity by (household_id, label) for locations, (household_id,
-- name) for children, and (child_id, title) for activities. Re-running this
-- after corrections updates the records in place.
--
-- Run via the Supabase SQL editor or `supabase db push` after 0004.

do $$
declare
  h_id uuid;
  -- locations
  loc_home uuid;
  loc_gan_yali uuid;
  loc_gan_liam uuid;
  loc_gan_adam uuid;
  loc_soccer uuid;
  loc_drahi uuid;
  loc_neve_tzedek uuid;
  -- children
  c_yali uuid;
  c_liam uuid;
  c_adam uuid;
begin
  -- ── household
  select id into h_id from households where name = 'Roditi' limit 1;
  if h_id is null then
    insert into households (name, timezone) values ('Roditi', 'Asia/Jerusalem') returning id into h_id;
  end if;

  -- ── helper to upsert a location by (household, label)
  -- locations
  insert into locations (household_id, label, street, city, country, notes, is_common)
    values (h_id, 'Home', 'Neve Shalom 15', 'Tel Aviv', 'IL', null, true)
    on conflict do nothing;
  select id into loc_home from locations where household_id = h_id and label = 'Home' limit 1;
  if loc_home is null then
    insert into locations (household_id, label, street, city, country, notes, is_common)
      values (h_id, 'Home', 'Neve Shalom 15', 'Tel Aviv', 'IL', null, true) returning id into loc_home;
  else
    update locations set street = 'Neve Shalom 15', city = 'Tel Aviv', country = 'IL', notes = null, is_common = true
      where id = loc_home;
  end if;

  -- Gan Yali — Tartzav St 25, ends 16:00, ganenet Sari
  select id into loc_gan_yali from locations where household_id = h_id and label = 'Gan Yali' limit 1;
  if loc_gan_yali is null then
    insert into locations (household_id, label, street, city, country, notes, is_common)
      values (h_id, 'Gan Yali', 'Tartzav St 25', 'Tel Aviv', 'IL',
              E'Dismisses 16:00.\nGanenet: Sari +972 52-253-2439', true)
      returning id into loc_gan_yali;
  else
    update locations set
      street = 'Tartzav St 25', city = 'Tel Aviv', country = 'IL',
      notes = E'Dismisses 16:00.\nGanenet: Sari +972 52-253-2439', is_common = true
      where id = loc_gan_yali;
  end if;

  -- Gan Liam — Simtat Shefer 3, code 4477*, ends 16:15, ganenet Mayaan
  select id into loc_gan_liam from locations where household_id = h_id and label = 'Gan Liam' limit 1;
  if loc_gan_liam is null then
    insert into locations (household_id, label, street, city, country, notes, is_common)
      values (h_id, 'Gan Liam', 'Simtat Shefer 3', 'Tel Aviv', 'IL',
              E'Dismisses 16:15. Door code: 4477*\nGanenet: Mayaan +972 54-559-5477', true)
      returning id into loc_gan_liam;
  else
    update locations set
      street = 'Simtat Shefer 3', city = 'Tel Aviv', country = 'IL',
      notes = E'Dismisses 16:15. Door code: 4477*\nGanenet: Mayaan +972 54-559-5477', is_common = true
      where id = loc_gan_liam;
  end if;

  -- Gan Adam — Itzhak Elhanan 11, code 0852, ends 16:30, ganenet Sabrin
  select id into loc_gan_adam from locations where household_id = h_id and label = 'Gan Adam' limit 1;
  if loc_gan_adam is null then
    insert into locations (household_id, label, street, city, country, notes, is_common)
      values (h_id, 'Gan Adam', 'Itzhak Elhanan 11', 'Tel Aviv', 'IL',
              E'Dismisses 16:30. Door code: 0852\nGanenet: Sabrin +972 50-214-5770', true)
      returning id into loc_gan_adam;
  else
    update locations set
      street = 'Itzhak Elhanan 11', city = 'Tel Aviv', country = 'IL',
      notes = E'Dismisses 16:30. Door code: 0852\nGanenet: Sabrin +972 50-214-5770', is_common = true
      where id = loc_gan_adam;
  end if;

  -- Activity locations — clean labels (NO kid metadata in name or notes-on-chip)
  select id into loc_soccer from locations where household_id = h_id and label = 'Gan Meir Park' limit 1;
  if loc_soccer is null then
    insert into locations (household_id, label, street, city, country, notes, is_common)
      values (h_id, 'Gan Meir Park', 'King George St 35', 'Tel Aviv', 'IL',
              E'Coach: Almog +972 50-895-3534', true)
      returning id into loc_soccer;
  else
    update locations set
      street = 'King George St 35', city = 'Tel Aviv', country = 'IL',
      notes = E'Coach: Almog +972 50-895-3534', is_common = true
      where id = loc_soccer;
  end if;

  select id into loc_drahi from locations where household_id = h_id and label = 'Drahi Community Center' limit 1;
  if loc_drahi is null then
    insert into locations (household_id, label, street, city, country, notes, is_common)
      values (h_id, 'Drahi Community Center', 'Kalisher St 5', 'Tel Aviv', 'IL', null, true)
      returning id into loc_drahi;
  else
    update locations set
      street = 'Kalisher St 5', city = 'Tel Aviv', country = 'IL',
      notes = null, is_common = true
      where id = loc_drahi;
  end if;

  select id into loc_neve_tzedek from locations where household_id = h_id and label = 'Neve Tzedek Community Center' limit 1;
  if loc_neve_tzedek is null then
    insert into locations (household_id, label, street, city, country, notes, is_common)
      values (h_id, 'Neve Tzedek Community Center', 'Neve Shalom St 9', 'Tel Aviv', 'IL', null, true)
      returning id into loc_neve_tzedek;
  else
    update locations set
      street = 'Neve Shalom St 9', city = 'Tel Aviv', country = 'IL',
      notes = null, is_common = true
      where id = loc_neve_tzedek;
  end if;

  -- ── children — link each kid to their Gan + Home
  -- Yali (orange-ish)
  select id into c_yali from children where household_id = h_id and name = 'Yali' limit 1;
  if c_yali is null then
    insert into children (household_id, name, color, school_name, school_location_id, home_location_id)
      values (h_id, 'Yali', '#E89070', 'Gan Yali', loc_gan_yali, loc_home)
      returning id into c_yali;
  else
    update children set
      color = '#E89070',
      school_name = 'Gan Yali',
      school_location_id = loc_gan_yali,
      home_location_id = loc_home
      where id = c_yali;
  end if;

  -- Liam (blue-ish)
  select id into c_liam from children where household_id = h_id and name = 'Liam' limit 1;
  if c_liam is null then
    insert into children (household_id, name, color, school_name, school_location_id, home_location_id)
      values (h_id, 'Liam', '#5A8FA8', 'Gan Liam', loc_gan_liam, loc_home)
      returning id into c_liam;
  else
    update children set
      color = '#5A8FA8',
      school_name = 'Gan Liam',
      school_location_id = loc_gan_liam,
      home_location_id = loc_home
      where id = c_liam;
  end if;

  -- Adam (green-ish)
  select id into c_adam from children where household_id = h_id and name = 'Adam' limit 1;
  if c_adam is null then
    insert into children (household_id, name, color, school_name, school_location_id, home_location_id)
      values (h_id, 'Adam', '#7FA87D', 'Gan Adam', loc_gan_adam, loc_home)
      returning id into c_adam;
  else
    update children set
      color = '#7FA87D',
      school_name = 'Gan Adam',
      school_location_id = loc_gan_adam,
      home_location_id = loc_home
      where id = c_adam;
  end if;

  -- ── activities. default_pickup = child's Gan; default_destination = activity location.
  --
  -- The "via" stop on the slot will be filled in from default_destination_location_id
  -- by the calendar import, while the slot's own destination_location_id will be Home.
  -- That way activities=where the activity happens, slot=full Gan→Activity→Home trip.

  -- Soccer Liam — Gan Liam → Gan Meir Park → Home
  insert into activities (child_id, title, default_pickup_location_id, default_destination_location_id, event_keyword, notes)
    values (c_liam, 'Soccer', loc_gan_liam, loc_soccer, 'soccer', null)
    on conflict do nothing;
  update activities set
    default_pickup_location_id = loc_gan_liam,
    default_destination_location_id = loc_soccer,
    notes = null
    where child_id = c_liam and title = 'Soccer';

  -- Judo Liam — Gan Liam → Drahi → Home
  insert into activities (child_id, title, default_pickup_location_id, default_destination_location_id, event_keyword, notes)
    values (c_liam, 'Judo', loc_gan_liam, loc_drahi, 'judo', null)
    on conflict do nothing;
  update activities set
    default_pickup_location_id = loc_gan_liam,
    default_destination_location_id = loc_drahi,
    notes = null
    where child_id = c_liam and title = 'Judo';

  -- Ninja Adam — Gan Adam → Drahi → Home
  insert into activities (child_id, title, default_pickup_location_id, default_destination_location_id, event_keyword, notes)
    values (c_adam, 'Ninja', loc_gan_adam, loc_drahi, 'ninja', null)
    on conflict do nothing;
  update activities set
    default_pickup_location_id = loc_gan_adam,
    default_destination_location_id = loc_drahi,
    notes = null
    where child_id = c_adam and title = 'Ninja';

  -- Judo Adam — Gan Adam → Neve Tzedek → Home
  insert into activities (child_id, title, default_pickup_location_id, default_destination_location_id, event_keyword, notes)
    values (c_adam, 'Judo', loc_gan_adam, loc_neve_tzedek, 'judo', null)
    on conflict do nothing;
  update activities set
    default_pickup_location_id = loc_gan_adam,
    default_destination_location_id = loc_neve_tzedek,
    notes = null
    where child_id = c_adam and title = 'Judo';

end $$;
