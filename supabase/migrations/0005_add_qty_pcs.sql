-- Pieces conversion for metre-stocked articles.
--
--     pcs = metres × 2145 ÷ size      (size = product of the dimensions)
--
-- Stores the result in qty_pcs. The app computes this on every import/add;
-- this migration adds the column and backfills rows already in the table.
-- Safe to re-run.

alter table public.rm_item
  add column if not exists qty_pcs numeric;

-- Rows already in pieces: qty_pcs mirrors inventory.
update public.rm_item
   set qty_pcs = round(inventory)
 where inventory is not null
   and lower(coalesce(uom, '')) not like 'm%';

-- Metre rows: metres × 2145 ÷ (first dimension × second dimension).
-- Separators x / X / × / space are all normalised to '*'. A size with only one
-- number yields NULL (can't convert without both dimensions).
update public.rm_item t
   set qty_pcs = sub.calc
  from (
    select id,
           round(inventory * 2145 / nullif(p1 * p2, 0)) as calc
      from (
        select id, inventory,
               nullif(regexp_replace(split_part(s, '*', 1), '[^0-9.]', '', 'g'), '')::numeric as p1,
               nullif(regexp_replace(split_part(s, '*', 2), '[^0-9.]', '', 'g'), '')::numeric as p2
          from (
            select id, inventory,
                   regexp_replace(coalesce(size, ''), '[xX×[:space:]]', '*', 'g') as s
              from public.rm_item
             where inventory is not null
               and lower(coalesce(uom, '')) like 'm%'
          ) a
      ) b
  ) sub
 where t.id = sub.id;

-- Verify:
-- select department, uom, count(*), count(qty_pcs) as with_pcs
--   from public.rm_item group by department, uom order by department, uom;
