-- Migration 0019 — Family documents store.
--
-- One table for any uploaded file the family wants at hand: passports,
-- teudat zehut, insurance cards, vaccination records, birth certificates,
-- medical notes. Files themselves live in Supabase Storage at
-- `family-documents/<household_id>/<filename>`; this table is the index
-- with metadata (owner, kind, expiry, notes).

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  uploaded_by uuid references profiles(id) on delete set null,
  -- Whose document is this? One of:
  --   'child'      → owner_child_id references children(id)
  --   'adult'      → owner_profile_id references profiles(id)
  --   'household'  → both nulls; applies to the whole family (e.g.,
  --                  household insurance, lease, etc.)
  owner_kind text not null check (owner_kind in ('child', 'adult', 'household')),
  owner_child_id uuid references children(id) on delete set null,
  owner_profile_id uuid references profiles(id) on delete set null,
  -- Display label and category. `kind` is free text for now (passport,
  -- id, insurance, vaccination, birth_cert, medical, other) so we can
  -- add new categories without a migration.
  label text not null,
  kind text,
  storage_path text not null,
  file_size_bytes int,
  mime_type text,
  expires_on date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists documents_household_idx
  on documents (household_id, created_at desc);

alter table documents enable row level security;

-- Documents are admin-only — even helpers in the household can't read
-- them. Sensitive enough that "every household member" is too broad.
create policy doc_admin_read on documents
  for select using (is_admin(household_id));
create policy doc_admin_write on documents
  for all using (is_admin(household_id))
  with check (is_admin(household_id));

comment on table documents is
  'Family documents (passports, IDs, insurance, etc). File payloads live in Supabase Storage bucket "family-documents".';
