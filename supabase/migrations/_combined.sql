-- Pickup Planner — initial schema
-- Run via Supabase CLI: `supabase db push`
-- Or paste into SQL editor in order: this file, then 0002_rls.sql, then 0003_seed.sql.

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------
-- Households & membership
-- ----------------------------------------------------------------------
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  timezone text not null default 'Asia/Jerusalem',
  locale text not null default 'en',
  created_at timestamptz not null default now()
);

-- `profiles.id` == `auth.users.id`. Created on first login via trigger below.
create type user_role as enum ('admin', 'helper');
create type helper_kind as enum ('grandparent', 'nanny', 'other');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone_number text,
  home_address text,
  home_lat numeric,
  home_lng numeric,
  role user_role not null default 'helper',
  helper_kind helper_kind,
  color text,
  sms_enabled boolean not null default false,
  email_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table household_members (
  household_id uuid references households(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role user_role not null default 'helper',
  helper_kind helper_kind,
  invited_email text,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index on household_members (user_id);

-- ----------------------------------------------------------------------
-- Reusable locations
-- ----------------------------------------------------------------------
create table locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  label text not null,          -- e.g. "School Main Gate"
  street text,
  city text,
  postal_code text,
  country text default 'IL',
  lat numeric,
  lng numeric,
  notes text,                   -- "Wait near basketball court"
  is_common boolean not null default false,
  created_at timestamptz not null default now()
);
create index on locations (household_id);

-- ----------------------------------------------------------------------
-- Children and their activities
-- ----------------------------------------------------------------------
create table children (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  color text not null default '#7FA87D',  -- hex for chip/card
  school_name text,
  school_location_id uuid references locations(id),
  home_location_id uuid references locations(id),
  notes text,
  created_at timestamptz not null default now()
);
create index on children (household_id);

-- Recurring activity definitions (Football, Dance, School, etc.)
create table activities (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children(id) on delete cascade,
  title text not null,
  default_pickup_location_id uuid references locations(id),
  default_destination_location_id uuid references locations(id),
  weekday smallint,               -- 0=Sun..6=Sat, optional
  start_time time,
  end_time time,
  notes text,                     -- parent instructions ("side gate")
  event_keyword text,             -- maps calendar event title -> activity
  created_at timestamptz not null default now()
);
create index on activities (child_id);

-- ----------------------------------------------------------------------
-- Google Calendar connection
-- ----------------------------------------------------------------------
create table connected_calendars (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  owner_user_id uuid not null references profiles(id) on delete cascade,
  google_account_email text not null,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  -- JSON array of selected calendar IDs to sync
  selected_calendar_ids jsonb not null default '[]'::jsonb,
  -- filtering rules
  include_keywords text[] default '{}',
  exclude_keywords text[] default '{}',
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz not null default now()
);
create unique index connected_calendars_household_owner
  on connected_calendars (household_id);  -- enforce "one primary" for v1

-- ----------------------------------------------------------------------
-- Raw calendar events (snapshot of source-of-truth from Google)
-- ----------------------------------------------------------------------
create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  calendar_id text not null,          -- google calendar id
  google_event_id text not null,      -- unique per calendar
  title text,
  description text,
  location_text text,                 -- raw location string from google
  start_at timestamptz not null,
  end_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, google_event_id)
);
create index on calendar_events (household_id, start_at);

-- ----------------------------------------------------------------------
-- Pickup slots (derived from calendar events OR created manually)
-- ----------------------------------------------------------------------
create type slot_status as enum ('unclaimed', 'claimed', 'completed', 'canceled');

create table pickup_slots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  activity_id uuid references activities(id) on delete set null,
  source_event_id uuid references calendar_events(id) on delete set null,
  source text not null default 'calendar',  -- 'calendar' | 'manual'
  title text not null,                       -- display title
  date date not null,
  pickup_time time not null,
  end_time time,
  pickup_location_id uuid references locations(id),
  destination_location_id uuid references locations(id),
  pickup_location_text text,                 -- raw fallback if no structured loc
  destination_text text,
  notes text,
  parent_notes text,                         -- visible only to admins
  status slot_status not null default 'unclaimed',
  reminder_sent_at timestamptz,
  claim_cutoff_at timestamptz,               -- overrides household default if set
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on pickup_slots (household_id, date);
create index on pickup_slots (status);
-- Prevent duplicate slots on resync. Plain UNIQUE (not partial) because
-- Supabase JS upsert with onConflict='source_event_id' requires a regular
-- unique constraint or full unique index. Multiple NULLs are allowed by
-- default (Postgres NULLS DISTINCT), so manual slots coexist fine.
create unique index pickup_slots_source_event_unique
  on pickup_slots (source_event_id);

-- ----------------------------------------------------------------------
-- Slot assignments (history-aware; only one active per slot)
-- ----------------------------------------------------------------------
create type assignment_status as enum ('active', 'released', 'overridden');

create table slot_assignments (
  id uuid primary key default gen_random_uuid(),
  pickup_slot_id uuid not null references pickup_slots(id) on delete cascade,
  assigned_to_user_id uuid not null references profiles(id) on delete cascade,
  assigned_by_user_id uuid references profiles(id),   -- null = self-claim
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  status assignment_status not null default 'active'
);
create unique index slot_assignments_one_active
  on slot_assignments (pickup_slot_id)
  where status = 'active';

-- ----------------------------------------------------------------------
-- Reminder settings (household-level)
-- ----------------------------------------------------------------------
create table reminder_settings (
  household_id uuid primary key references households(id) on delete cascade,
  morning_send_time time not null default '07:30',
  send_evening_before boolean not null default false,
  evening_send_time time not null default '20:00',
  cutoff_time time not null default '20:00',        -- previous evening cutoff
  parent_fallback_alert boolean not null default true,
  timezone text not null default 'Asia/Jerusalem',
  email_template_override text,
  sms_template_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------
-- Outbound message log
-- ----------------------------------------------------------------------
create type notify_channel as enum ('email', 'sms');
create type notify_status as enum ('queued', 'sent', 'failed');

create table notification_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  pickup_slot_id uuid references pickup_slots(id) on delete set null,
  to_user_id uuid references profiles(id) on delete set null,
  channel notify_channel not null,
  to_address text not null,         -- email or phone
  subject text,
  body text not null,
  status notify_status not null default 'queued',
  provider_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notification_logs (household_id, created_at desc);

-- ----------------------------------------------------------------------
-- Utility: auto-touch updated_at
-- ----------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger pickup_slots_touch before update on pickup_slots
  for each row execute function touch_updated_at();
create trigger calendar_events_touch before update on calendar_events
  for each row execute function touch_updated_at();
create trigger reminder_settings_touch before update on reminder_settings
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------------------
-- Auto-create profile on signup
-- ----------------------------------------------------------------------
create or replace function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
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
-- Personal weekly-invite links + slot activity feed.

-- Tokens are long random strings stored on the profile. Hitting
-- /i/<token> sets a session cookie and lands the user on /my-pickups.
-- Reusable, not single-use — they're personal links, not OTPs.
alter table profiles
  add column if not exists magic_token text unique,
  add column if not exists token_issued_at timestamptz,
  add column if not exists last_invite_sent_at timestamptz;

create index if not exists profiles_magic_token_idx on profiles (magic_token);

-- Activity feed for the admin dashboard. Append-only.
do $$ begin
  create type slot_event_kind as enum (
    'created', 'claimed', 'released', 'reassigned', 'unassigned', 'updated'
  );
exception when duplicate_object then null; end $$;

create table if not exists slot_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  pickup_slot_id uuid references pickup_slots(id) on delete set null,
  actor_user_id uuid references profiles(id) on delete set null,
  subject_user_id uuid references profiles(id) on delete set null,
  kind slot_event_kind not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists slot_events_household_time_idx
  on slot_events (household_id, created_at desc);

-- RLS for slot_events: members of the household can read; only writes via
-- service role (server actions use service role for admin reads).
alter table slot_events enable row level security;

drop policy if exists se_member_read on slot_events;
create policy se_member_read on slot_events for select using (is_member(household_id));
drop policy if exists se_no_client_write on slot_events;
create policy se_no_client_write on slot_events for all using (false) with check (false);

-- Reminder settings: which day of week to send weekly invites (0=Sun..6=Sat)
alter table reminder_settings
  add column if not exists weekly_invite_day smallint not null default 6, -- Saturday
  add column if not exists weekly_invite_time time not null default '09:00';
