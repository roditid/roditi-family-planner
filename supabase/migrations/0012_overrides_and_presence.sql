-- Migration 0012 — daily overrides + full-presence flag
--
-- Two new concepts driven by Paula's calendar conventions:
--
--   daily_overrides  — per-(date, child) markers that change how the
--                       defaults generator behaves on that day:
--     • kind='no_gan'           → no Gan→Home default for that kid
--     • kind='early_dismissal'  → use override.dismissal_time instead of
--                                  the kid's normal gan_dismissal_time
--     • kind='last_day_school'  → Adam-only: school activity at the same
--                                  address with different hours; reminds
--                                  Paula one week prior to define them
--
--   pickup_slots.requires_full_presence — for special at-Gan activities
--     (Shavuot, Lag Baomer, parent days). The helper is expected to be
--     there for the whole event, not just to drop off + return.

create table if not exists daily_overrides (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  child_id uuid references children(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('no_gan', 'early_dismissal', 'last_day_school', 'prep_day', 'all_kids_no_gan')),
  dismissal_time time,
  source_event_id uuid references calendar_events(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists daily_overrides_lookup on daily_overrides (household_id, date, child_id);
-- Two rows for the same (kid, date, kind) are pointless; an upsert anchor.
create unique index if not exists daily_overrides_unique
  on daily_overrides (household_id, coalesce(child_id, '00000000-0000-0000-0000-000000000000'::uuid), date, kind);

comment on table daily_overrides is
  'Per-day exceptions to the regular Gan schedule, parsed from special calendar event titles.';

alter table pickup_slots
  add column if not exists requires_full_presence boolean not null default false;

comment on column pickup_slots.requires_full_presence is
  'When true, the helper stays for the whole activity (Shavuot, Lag Baomer, parent days) rather than just doing pickup.';
