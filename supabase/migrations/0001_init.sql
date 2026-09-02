-- RM Stock Portal — schema.
--
-- One row per raw-material design. An item belongs to a DEPARTMENT (Digital
-- Print, Labels, Runner, Patta, …) and, within it, to a GROUP (for Digital
-- Print this is the "Thaily"). Department + group + serial number is how the
-- floor refers to any item. Photos are hosted on Cloudinary; the row keeps only
-- the Cloudinary public_id in `photo_path`.

create table if not exists public.rm_item (
  id          bigint generated always as identity primary key,
  department  text        not null default 'Digital Print',  -- e.g. Labels, Runner, Patta
  thaily      text        not null,          -- group within a department ("1"/"2"/"3" for Digital Print)
  sr          integer     not null,          -- serial number within the group
  size        text,                          -- e.g. "15*12"
  colour      text,                          -- colour code(s), e.g. "NBL-RD"
  character   text,                          -- design / character, e.g. "AVENGERS"
  name        text,                          -- item name
  inventory   numeric,                       -- on-hand quantity from the sheet
  uom         text,                          -- Pcs / Mtr
  photo_path  text,                          -- Cloudinary public_id, or null
  photo_updated_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (department, thaily, sr)
);

create index if not exists rm_item_dept_thaily_sr_idx
  on public.rm_item (department, thaily, sr);

-- ── Row-level security ──────────────────────────────────────────────────────
-- Reads are open to everyone (the gallery is browsed without signing in).
-- Writes go through the server (service role), which bypasses RLS, so no
-- write policy is granted to anon/authenticated here.
alter table public.rm_item enable row level security;

drop policy if exists rm_item_read on public.rm_item;
create policy rm_item_read on public.rm_item for select using (true);

-- Photos are stored on Cloudinary, not in Supabase Storage — no bucket needed.
