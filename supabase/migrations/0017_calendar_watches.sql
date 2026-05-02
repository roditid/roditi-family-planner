-- Migration 0017 — Google Calendar push notification (watch) state.
--
-- Persisted on connected_calendars so we always know:
--   • the channel id we generated (used to verify incoming webhooks)
--   • the resource id Google returned (used for stop / renew calls)
--   • when the watch expires (Google caps at 7 days)
--
-- Renewal is handled by the daily sync-calendar cron — when a watch is
-- within 24h of expiry, the cron re-registers it.

alter table connected_calendars
  add column if not exists watch_channel_id text,
  add column if not exists watch_resource_id text,
  add column if not exists watch_expires_at timestamptz;
