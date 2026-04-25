-- Migration 0004 — multi-stop trips & sibling-combined pickups
--
-- Two new concepts on pickup_slots:
--
--  1. via_location  — an intermediate stop between pickup and destination.
--     Models the real Roditi flow: "Gan → Activity → Home" is ONE pickup,
--     one helper, three stops. Without this, Soccer was Gan → Soccer
--     (drop-off only) and we'd need a separate Soccer → Home slot.
--
--  2. additional_child_ids[] — when 2+ siblings are all going home with no
--     activity, we generate ONE slot for the helper, not three. The primary
--     child_id is the youngest (earliest dismissal). additional_child_ids
--     holds the others; the chip displays all photos and the modal lists
--     each Gan stop with its dismissal time.
--
-- Both columns are nullable / default empty so existing rows are unaffected.

alter table pickup_slots
  add column if not exists via_location_id uuid references locations(id) on delete set null,
  add column if not exists via_location_text text,
  add column if not exists additional_child_ids uuid[] not null default '{}';

create index if not exists pickup_slots_via_location_id_idx on pickup_slots (via_location_id);

comment on column pickup_slots.via_location_id is
  'Intermediate stop on the trip (e.g. activity location). pickup → via → destination.';
comment on column pickup_slots.additional_child_ids is
  'When siblings share a Gan→Home pickup, the primary kid is in child_id and the rest are listed here in pickup-time order.';
