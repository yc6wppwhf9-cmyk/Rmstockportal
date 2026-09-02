-- Departments differ in their columns. Digital Print has Size / Design; Labels
-- and Runner have Colour Code / Colour / Stock / INV / Item Name, and no Thaily.
--
-- Core columns stay typed; anything department-specific goes into `extra` (a
-- JSON map of label → value) so a new department's sheet imports without a
-- schema change. Group ("thaily") is kept but may be 'All' for departments
-- that don't use it.

alter table public.rm_item
  add column if not exists extra jsonb not null default '{}'::jsonb;
