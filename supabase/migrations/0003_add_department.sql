-- Patch: add the `department` column to an existing rm_item table.
--
-- Needed only if you created the table from an earlier schema that had no
-- department column. Existing rows backfill to 'Digital Print' via the default,
-- so no re-seed is required. Safe to re-run.

alter table public.rm_item
  add column if not exists department text not null default 'Digital Print';

alter table public.rm_item
  add column if not exists photo_updated_at timestamptz;

-- Replace the old unique (thaily, sr) with unique (department, thaily, sr).
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.rm_item'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (thaily, sr)';
  if c is not null then
    execute format('alter table public.rm_item drop constraint %I', c);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.rm_item'::regclass
       and contype = 'u'
       and pg_get_constraintdef(oid) = 'UNIQUE (department, thaily, sr)'
  ) then
    alter table public.rm_item
      add constraint rm_item_department_thaily_sr_key unique (department, thaily, sr);
  end if;
end $$;

create index if not exists rm_item_dept_thaily_sr_idx
  on public.rm_item (department, thaily, sr);

-- Verify:
-- select department, thaily, count(*) from public.rm_item
--   group by department, thaily order by department, thaily;
