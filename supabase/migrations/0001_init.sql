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

-- DEFERRABLE INITIALLY DEFERRED on the FK so the on_auth_user_created
-- trigger (below) can insert the profile row in the same transaction as
-- auth.users without hitting an FK violation under Supabase's connection
-- pool / isolation behavior.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade deferrable initially deferred,
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
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  insert into public.profiles (id, full_name, email)
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
