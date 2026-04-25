-- Row-Level Security — household-scoped access.
-- All helpers see their household's slots/children/locations.
-- Only admins can mutate schedule/settings tables.
-- Anyone can read their own profile.

-- Helper: is the caller a member of this household?
create or replace function is_member(h uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from household_members
    where household_id = h and user_id = auth.uid()
  );
$$;

-- Helper: is the caller an admin of this household?
create or replace function is_admin(h uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from household_members
    where household_id = h and user_id = auth.uid() and role = 'admin'
  );
$$;

-- --------- Enable RLS on everything ---------
alter table households               enable row level security;
alter table profiles                 enable row level security;
alter table household_members        enable row level security;
alter table locations                enable row level security;
alter table children                 enable row level security;
alter table activities               enable row level security;
alter table connected_calendars      enable row level security;
alter table calendar_events          enable row level security;
alter table pickup_slots             enable row level security;
alter table slot_assignments         enable row level security;
alter table reminder_settings        enable row level security;
alter table notification_logs        enable row level security;

-- --------- profiles ---------
create policy profiles_self_read on profiles for select using (id = auth.uid());
create policy profiles_household_read on profiles for select using (
  exists (
    select 1 from household_members m1
    join household_members m2 on m1.household_id = m2.household_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id
  )
);
create policy profiles_self_update on profiles for update using (id = auth.uid());

-- --------- households ---------
create policy households_member_read on households for select using (is_member(id));
create policy households_admin_update on households for update using (is_admin(id));

-- --------- household_members ---------
create policy hm_member_read on household_members for select using (is_member(household_id));
create policy hm_admin_write on household_members for all
  using (is_admin(household_id))
  with check (is_admin(household_id));

-- --------- locations ---------
create policy loc_member_read on locations for select using (is_member(household_id));
create policy loc_admin_write on locations for all
  using (is_admin(household_id))
  with check (is_admin(household_id));

-- --------- children ---------
create policy child_member_read on children for select using (is_member(household_id));
create policy child_admin_write on children for all
  using (is_admin(household_id))
  with check (is_admin(household_id));

-- --------- activities ---------
create policy act_member_read on activities for select using (
  exists (select 1 from children c where c.id = activities.child_id and is_member(c.household_id))
);
create policy act_admin_write on activities for all using (
  exists (select 1 from children c where c.id = activities.child_id and is_admin(c.household_id))
) with check (
  exists (select 1 from children c where c.id = activities.child_id and is_admin(c.household_id))
);

-- --------- connected_calendars ---------
create policy cal_member_read on connected_calendars for select using (is_member(household_id));
create policy cal_admin_write on connected_calendars for all
  using (is_admin(household_id))
  with check (is_admin(household_id));

-- --------- calendar_events ---------
create policy cev_member_read on calendar_events for select using (is_member(household_id));
-- writes only via service role (sync job)
create policy cev_none_write on calendar_events for all using (false) with check (false);

-- --------- pickup_slots ---------
create policy slot_member_read on pickup_slots for select using (is_member(household_id));
create policy slot_admin_write on pickup_slots for all
  using (is_admin(household_id))
  with check (is_admin(household_id));
-- helpers may update *nothing* on slots directly; claim/unclaim go through slot_assignments.

-- --------- slot_assignments ---------
create policy sa_member_read on slot_assignments for select using (
  exists (select 1 from pickup_slots s where s.id = slot_assignments.pickup_slot_id and is_member(s.household_id))
);
-- Helper can claim an unclaimed slot for themselves only.
create policy sa_self_claim on slot_assignments for insert with check (
  assigned_to_user_id = auth.uid()
  and exists (
    select 1 from pickup_slots s
    where s.id = slot_assignments.pickup_slot_id
      and is_member(s.household_id)
      and s.status = 'unclaimed'
  )
);
-- Helper can release their own active assignment.
create policy sa_self_release on slot_assignments for update using (
  assigned_to_user_id = auth.uid() and status = 'active'
) with check (
  assigned_to_user_id = auth.uid()
);
-- Admin can do anything.
create policy sa_admin_all on slot_assignments for all using (
  exists (select 1 from pickup_slots s where s.id = slot_assignments.pickup_slot_id and is_admin(s.household_id))
) with check (
  exists (select 1 from pickup_slots s where s.id = slot_assignments.pickup_slot_id and is_admin(s.household_id))
);

-- --------- reminder_settings ---------
create policy rem_member_read on reminder_settings for select using (is_member(household_id));
create policy rem_admin_write on reminder_settings for all
  using (is_admin(household_id))
  with check (is_admin(household_id));

-- --------- notification_logs ---------
create policy nl_admin_read on notification_logs for select using (is_admin(household_id));
create policy nl_self_read on notification_logs for select using (to_user_id = auth.uid());
create policy nl_none_write on notification_logs for all using (false) with check (false);
