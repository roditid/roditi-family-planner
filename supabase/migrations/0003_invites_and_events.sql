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
