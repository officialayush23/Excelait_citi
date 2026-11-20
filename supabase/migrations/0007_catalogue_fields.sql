-- ExcelAIt 0007: fields used by matching, eligibility and offline sync.

alter table public.careers
  add column if not exists rural_demand numeric(3, 2) not null default 0.5 check (rural_demand between 0 and 1),
  add column if not exists needs_city boolean not null default false,
  add column if not exists scheme_slugs text[] not null default '{}',
  add column if not exists exam_slugs text[] not null default '{}';

alter table public.schemes
  add column if not exists verify jsonb not null default '[]'::jsonb,
  add column if not exists sources jsonb not null default '[]'::jsonb,
  add column if not exists documents text[] not null default '{}';

-- Every fact a scheme rule or the matcher can use, keyed by the names in shared/rules/fields.json.
alter table public.student_profiles
  add column if not exists facts jsonb not null default '{}'::jsonb;

-- Read by the app to know when its bundled catalogue is out of date.
create or replace view public.catalogue_version with (security_invoker = true) as
  select greatest(
    (select coalesce(max(updated_at), 'epoch') from public.careers),
    (select coalesce(max(updated_at), 'epoch') from public.schemes),
    (select coalesce(max(created_at), 'epoch') from public.scheme_rules)
  ) as updated_at;
grant select on public.catalogue_version to anon, authenticated;
