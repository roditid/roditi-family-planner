-- Migration 0020 — admin override flag for combined Gan→Home pickups.
--
-- Defaults generator combines siblings automatically using the
-- "skip the kid who has an activity that day; combine the others +
-- Yali" rule. But Paula wants to override this on a case-by-case basis
-- (e.g., split a combined Yali+Adam into two separate pickups, or
-- combine Yali with Liam instead of Adam). This column marks rows the
-- admin has manually arranged; the defaults generator preserves them
-- on regeneration.

alter table pickup_slots
  add column if not exists manually_arranged boolean not null default false;

comment on column pickup_slots.manually_arranged is
  'When true, the daily defaults generator leaves this row alone. Set by admin actions (split/merge combined Gan→Home pickups).';
