-- ExcelAIt 0016: one store for everything found on the web (scholarships, jobs, apprenticeships,
-- notices, plain web results). Each item is kept until its own time runs out (valid_until) and is
-- shared by every student: a scholarship or job found for one student is matched for the next one
-- from the database before the web is searched again. search_log records every search so repeat
-- questions are answered from the database first.

create table if not exists public.knowledge_items (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('scholarship', 'job', 'apprenticeship', 'notice', 'web')),
  source_url      text not null unique,
  source_site     text,
  title           text not null,
  provider        text,
  data            jsonb not null default '{}'::jsonb,   -- the full structured record
  eligibility     jsonb not null default '{}'::jsonb,   -- parsed criteria; unparsed ones listed under "unknown"
  state           text,
  district        text,
  tags            text[] not null default '{}',
  valid_until     timestamptz not null,                 -- deleted only after this
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  hits            integer not null default 0
);
create index if not exists knowledge_items_kind_valid_idx on public.knowledge_items (kind, valid_until);
create index if not exists knowledge_items_state_idx on public.knowledge_items (kind, state);
create index if not exists knowledge_items_district_idx on public.knowledge_items (kind, lower(district));
create index if not exists knowledge_items_tags_idx on public.knowledge_items using gin (tags);

create table if not exists public.search_log (
  id          uuid primary key default gen_random_uuid(),
  query       text not null,
  query_key   text not null,                            -- normalised query, for "searched before?"
  kind        text not null,
  filters     jsonb not null default '{}'::jsonb,
  item_ids    uuid[] not null default '{}',
  provider    text,
  meta        jsonb not null default '{}'::jsonb,       -- extras shown with the results (listing pages, place searched)
  valid_until timestamptz not null default (now() + interval '30 days'),
  created_at  timestamptz not null default now()
);
create index if not exists search_log_key_idx on public.search_log (query_key, kind, created_at desc);

-- Count how often stored items are shown.
create or replace function public.knowledge_hit(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.knowledge_items set hits = hits + 1 where id = any(p_ids);
$$;

-- The only way items leave the store: their own time has run out.
create or replace function public.delete_expired_knowledge()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.knowledge_items where valid_until < now();
  get diagnostics n = row_count;
  delete from public.search_log where valid_until < now();
  return n;
end $$;

revoke execute on function public.knowledge_hit(uuid[]) from public, anon, authenticated;
revoke execute on function public.delete_expired_knowledge() from public, anon, authenticated;
grant execute on function public.knowledge_hit(uuid[]) to service_role;
grant execute on function public.delete_expired_knowledge() to service_role;

alter table public.knowledge_items enable row level security;
alter table public.search_log enable row level security;
grant all on public.knowledge_items, public.search_log to service_role;

-- Daily cleanup at 00:30 IST (19:00 UTC) with pg_cron when the extension can be enabled.
-- pg_cron 1.6.4 is available on this project (not yet installed). The backend also runs the same
-- cleanup once a day, so nothing breaks if this block is skipped.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;
    perform cron.unschedule(jobid) from cron.job where jobname = 'delete-expired-knowledge';
    perform cron.schedule('delete-expired-knowledge', '0 19 * * *', 'select public.delete_expired_knowledge()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%); the backend daily cleanup will run instead', sqlerrm;
end $$;
