-- ExcelAIt 0001: extensions, enums, identity, roles, consent
-- Every table has RLS enabled. The FastAPI backend uses the secret key for
-- privileged work; the browser only ever uses the publishable key.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------- enums ----------
create type public.app_role as enum (
  'student', 'facilitator', 'parent', 'mentor', 'partner', 'funder', 'admin'
);
create type public.student_stage as enum ('school', 'college', 'out_of_school');
create type public.career_category as enum (
  'stem', 'non_stem', 'vocational', 'skilled_trade', 'agriculture',
  'creative', 'government', 'emerging', 'entrepreneurship', 'healthcare', 'services'
);
create type public.scheme_kind as enum (
  'scholarship', 'scheme', 'apprenticeship', 'internship', 'loan', 'entrepreneurship'
);
create type public.eligibility_result as enum ('eligible', 'not_eligible', 'needs_info');

-- ---------- helpers ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- districts (needed by profiles) ----------
create table public.districts (
  id          bigint generated always as identity primary key,
  name        text not null,
  state       text not null,
  lgd_code    text unique,
  created_at  timestamptz not null default now(),
  unique (name, state)
);

-- ---------- profiles & roles ----------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text,
  email               text,
  phone               text,
  preferred_language  text not null default 'en',
  district_id         bigint references public.districts (id),
  state               text,
  date_of_birth       date,
  gender              text,
  avatar_url          text,
  onboarded_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on public.profiles (district_id);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.user_roles (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.app_role not null,
  granted_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  primary key (user_id, role)
);
create index on public.user_roles (granted_by);

-- Security-definer role check used by RLS policies (avoids recursive RLS).
create or replace function public.has_role(check_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = check_role
  );
$$;

-- New auth user -> profile + one self-service role.
-- Only non-privileged roles can be chosen at sign-up; funder/admin are granted by an admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  requested text := coalesce(new.raw_user_meta_data ->> 'role', 'student');
  chosen public.app_role;
begin
  if requested not in ('student', 'facilitator', 'parent', 'mentor', 'partner') then
    requested := 'student';
  end if;
  chosen := requested::public.app_role;

  insert into public.profiles (id, email, full_name, preferred_language)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data ->> 'language', 'en')
  );
  insert into public.user_roles (user_id, role) values (new.id, chosen);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- guardians, consent, devices ----------
create table public.guardians (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.profiles (id) on delete cascade,
  guardian_user_id  uuid references public.profiles (id) on delete set null,
  name              text not null,
  relation          text,
  phone             text,
  email             text,
  created_at        timestamptz not null default now()
);
create index on public.guardians (student_id);
create index on public.guardians (guardian_user_id);

create table public.consents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('data_processing', 'guardian', 'community', 'earn', 'voice')),
  granted       boolean not null,
  granted_by    uuid references public.profiles (id),
  policy_version text not null default 'v1',
  granted_at    timestamptz not null default now(),
  withdrawn_at  timestamptz
);
create index on public.consents (user_id);
create index on public.consents (granted_by);

create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  label         text,
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index on public.devices (owner_id);

-- Picture-PIN profiles: several students share one phone.
create table public.shared_phone_profiles (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references public.devices (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  picture_key  text not null,
  pin_hash     text not null,
  created_at   timestamptz not null default now(),
  unique (device_id, student_id)
);
create index on public.shared_phone_profiles (student_id);

-- ---------- RLS ----------
alter table public.districts enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.guardians enable row level security;
alter table public.consents enable row level security;
alter table public.devices enable row level security;
alter table public.shared_phone_profiles enable row level security;

create policy "districts readable by everyone" on public.districts
  for select to anon, authenticated using (true);

create policy "read own profile or admin" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.has_role('admin')));
create policy "update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "read own roles" on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()));

create policy "student or guardian reads guardian link" on public.guardians
  for select to authenticated
  using (student_id = (select auth.uid()) or guardian_user_id = (select auth.uid()));

create policy "read own consents" on public.consents
  for select to authenticated using (user_id = (select auth.uid()));

create policy "read own devices" on public.devices
  for select to authenticated using (owner_id = (select auth.uid()));
-- shared_phone_profiles: backend only (PIN hashes never reach the browser).
