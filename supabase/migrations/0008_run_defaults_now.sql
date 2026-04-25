-- Migration 0008 — generate daily Gan→Home defaults for the next 21 weekdays
--
-- Mirrors lib/defaults.ts: for each weekday in [today, today+21), if a kid
-- has no activity slot that day, group them with siblings going home and
-- create one combined Gan→Home pickup.
--
-- Idempotent: deletes UNCLAIMED 'auto-default' slots before regenerating.
-- Claimed defaults are preserved.

do $$
declare
  h_id uuid;
  c_yali uuid; c_liam uuid; c_adam uuid;
  yali_school uuid; yali_home uuid; yali_dismiss time;
  liam_school uuid; liam_home uuid; liam_dismiss time;
  adam_school uuid; adam_home uuid; adam_dismiss time;
  d date;
  end_d date;
  yali_busy boolean; liam_busy boolean; adam_busy boolean;
  going jsonb := '[]'::jsonb;
  primary_kid uuid;
  primary_school uuid;
  primary_home uuid;
  primary_time time;
  additional uuid[];
  trip_title text;
begin
  select id into h_id from households where name = 'Roditi Family' limit 1;

  select id, school_location_id, home_location_id, gan_dismissal_time
    into c_yali, yali_school, yali_home, yali_dismiss
    from children where household_id = h_id and name = 'Yali' limit 1;
  select id, school_location_id, home_location_id, gan_dismissal_time
    into c_liam, liam_school, liam_home, liam_dismiss
    from children where household_id = h_id and name = 'Liam' limit 1;
  select id, school_location_id, home_location_id, gan_dismissal_time
    into c_adam, adam_school, adam_home, adam_dismiss
    from children where household_id = h_id and name = 'Adam' limit 1;

  -- Wipe unclaimed auto-defaults for the upcoming 21 days
  delete from pickup_slots
    where household_id = h_id
      and source = 'auto-default'
      and status = 'unclaimed'
      and date >= current_date
      and date < current_date + 21;

  end_d := current_date + 21;
  d := current_date;
  while d < end_d loop
    -- Skip Israeli weekend (Fri=5, Sat=6 in PG dow)
    if extract(dow from d) not in (5, 6) then
      yali_busy := exists(select 1 from pickup_slots where household_id=h_id and child_id=c_yali and date=d and activity_id is not null);
      liam_busy := exists(select 1 from pickup_slots where household_id=h_id and child_id=c_liam and date=d and activity_id is not null);
      adam_busy := exists(select 1 from pickup_slots where household_id=h_id and child_id=c_adam and date=d and activity_id is not null);

      -- Build the route (Liam → Adam → Yali → Home — farthest from home first)
      additional := '{}';
      primary_kid := null;
      trip_title := '';
      if not liam_busy and liam_school is not null and liam_home is not null and liam_dismiss is not null then
        primary_kid := c_liam;
        primary_school := liam_school;
        primary_home := liam_home;
        primary_time := liam_dismiss;
        trip_title := 'Liam';
        if not adam_busy and adam_school is not null then
          additional := array_append(additional, c_adam);
          trip_title := trip_title || ' → Adam';
        end if;
        if not yali_busy and yali_school is not null then
          additional := array_append(additional, c_yali);
          trip_title := trip_title || ' → Yali';
        end if;
      elsif not adam_busy and adam_school is not null and adam_home is not null and adam_dismiss is not null then
        primary_kid := c_adam;
        primary_school := adam_school;
        primary_home := adam_home;
        primary_time := adam_dismiss;
        trip_title := 'Adam';
        if not yali_busy and yali_school is not null then
          additional := array_append(additional, c_yali);
          trip_title := trip_title || ' → Yali';
        end if;
      elsif not yali_busy and yali_school is not null and yali_home is not null and yali_dismiss is not null then
        primary_kid := c_yali;
        primary_school := yali_school;
        primary_home := yali_home;
        primary_time := yali_dismiss;
        trip_title := 'Yali';
      end if;

      if primary_kid is not null then
        trip_title := trip_title || ' → Home';
        insert into pickup_slots (
          household_id, child_id, additional_child_ids, activity_id, source,
          title, date, pickup_time, pickup_location_id, destination_location_id, status
        ) values (
          h_id, primary_kid, additional, null, 'auto-default',
          trip_title, d, primary_time, primary_school, primary_home, 'unclaimed'
        );
      end if;
    end if;
    d := d + 1;
  end loop;
end $$;
