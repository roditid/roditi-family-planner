-- Migration 0018 — Notification + system event log.
--
-- Records every email sent, every Google Calendar invite update, every
-- WhatsApp link built, plus any future channels we add. The /admin/activity
-- tab merges this with slot_events for a single chronological feed.

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  kind text not null,          -- 'email_sent' | 'email_failed' | 'calendar_invite' | 'calendar_title_updated' | 'wa_link_built' | 'wa_link_tapped'
  channel text,                 -- 'email' | 'google_calendar' | 'whatsapp'
  recipient text,               -- email, phone (digits-only), or '-'
  subject text,
  slot_id uuid references pickup_slots(id) on delete set null,
  actor_user_id uuid references profiles(id) on delete set null,
  status text not null default 'sent',  -- 'sent' | 'failed' | 'queued'
  error text,
  created_at timestamptz not null default now()
);
create index if not exists notification_events_lookup
  on notification_events (household_id, created_at desc);
