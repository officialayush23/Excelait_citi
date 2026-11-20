-- ExcelAIt 0009: the connected catalogue (programs, resources, colleges), plans,
-- the assistant, partner offerings matched by rules, and community structure.

-- ---------- Education programs: the steps between a student and a career ----------
create table public.programs (
  id              bigint generated always as identity primary key,
  slug            text not null unique,
  name            text not null,
  name_i18n       jsonb not null default '{}'::jsonb,
  level           text not null,            -- iti, diploma, ug, certificate, apprenticeship, recruitment, self_study
  duration_months smallint,
  entry           text not null,            -- minimum education
  "where"         text,
  college_kind    text,                     -- what kind of institution offers it (iti, nursing, polytechnic, ...)
  official_url    text,
  exam_slugs      text[] not null default '{}',
  scheme_slugs    text[] not null default '{}',
  verify          jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now()
);
alter table public.careers add column if not exists program_slugs text[] not null default '{}';

-- ---------- Free learning resources ----------
create table public.resources (
  id         bigint generated always as identity primary key,
  slug       text not null unique,
  title      text not null,
  provider   text not null,
  url        text not null,
  kind       text not null,                 -- course, video, book, practice, portal
  languages  text[] not null default '{}',
  tags       jsonb not null default '{}'::jsonb,  -- {careers:[], programs:[], exams:[], categories:[], stages:[]}
  org_id     uuid references public.organizations (id) on delete cascade,  -- set when a partner shares it
  updated_at timestamptz not null default now()
);
create index on public.resources (org_id);

-- ---------- Colleges and institutes (AISHE directory; partners can claim) ----------
create extension if not exists pg_trgm with schema extensions;
create table public.colleges (
  aishe_code   text primary key,
  name         text not null,
  state        text,
  district     text,
  year_est     smallint,
  location     text,                        -- Rural / Urban as reported to AISHE
  college_type text,
  management   text,
  university   text,
  kind         text,                        -- our derived kind: iti, nursing, polytechnic, engineering, ...
  org_id       uuid references public.organizations (id) on delete set null,  -- set once claimed
  details      jsonb not null default '{}'::jsonb,  -- courses, fees, seats, hostel, contact (from the claimed owner)
  updated_at   timestamptz not null default now()
);
create index on public.colleges (state, district);
create index on public.colleges (kind);
create index on public.colleges (org_id);
create index colleges_name_trgm on public.colleges using gin (name extensions.gin_trgm_ops);

alter table public.organizations add column if not exists aishe_code text references public.colleges (aishe_code) on delete set null;
alter table public.organizations add column if not exists contact_email text;
alter table public.organizations add column if not exists phone text;
alter table public.organizations add column if not exists state text;
alter table public.organizations add column if not exists district text;
alter table public.organizations add column if not exists rejection_reason text;
alter table public.organizations drop constraint if exists organizations_kind_check;
alter table public.organizations add constraint organizations_kind_check
  check (kind in ('college', 'iti', 'ngo', 'company', 'msme', 'csr', 'government', 'training_centre', 'school'));
create index if not exists organizations_aishe_idx on public.organizations (aishe_code);

-- ---------- Offerings from partners, matched to students by the same rules engine ----------
alter table public.opportunities drop constraint if exists opportunities_kind_check;
alter table public.opportunities add constraint opportunities_kind_check
  check (kind in ('internship', 'apprenticeship', 'workshop', 'bootcamp', 'hackathon', 'admission', 'job', 'mentorship',
                  'course', 'training', 'scholarship', 'resource', 'event'));
alter table public.opportunities add column if not exists rule jsonb;           -- rules-engine JSON; null = open to all students
alter table public.opportunities add column if not exists fee_inr integer not null default 0;
alter table public.opportunities add column if not exists seats integer;
alter table public.opportunities add column if not exists state text;
alter table public.opportunities add column if not exists district text;
alter table public.opportunities add column if not exists career_slugs text[] not null default '{}';
alter table public.opportunities add column if not exists program_slugs text[] not null default '{}';
alter table public.opportunities add column if not exists language text;
alter table public.opportunities add column if not exists published_at timestamptz;
alter table public.opportunities add column if not exists notified_count integer not null default 0;

-- ---------- Saved careers and plans ----------
create table public.saved_careers (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  career_slug text not null,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (user_id, career_slug)
);
alter table public.pathways add column if not exists career_slug text;
alter table public.pathways add column if not exists target_year smallint;
alter table public.pathway_steps drop constraint if exists pathway_steps_kind_check;
alter table public.pathway_steps add constraint pathway_steps_kind_check
  check (kind in ('skill', 'course', 'exam', 'task', 'lesson', 'program', 'scheme', 'document', 'college', 'milestone', 'opportunity'));
create index if not exists pathways_user_career_idx on public.pathways (user_id, career_slug);

-- ---------- Assistant ----------
create table public.assistant_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.assistant_threads (user_id, updated_at desc);
create table public.assistant_messages (
  id         bigint generated always as identity primary key,
  thread_id  uuid not null references public.assistant_threads (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null default '',
  cards      jsonb not null default '[]'::jsonb,
  tools      text[] not null default '{}',
  tokens     integer,
  created_at timestamptz not null default now()
);
create index on public.assistant_messages (thread_id, id);

-- Web search results are cached so the same question does not cost twice.
create table public.search_cache (
  key        text primary key,
  provider   text not null,
  query      text not null,
  results    jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- Community structure ----------
alter table public.groups drop constraint if exists groups_kind_check;
alter table public.groups add constraint groups_kind_check
  check (kind in ('district', 'school', 'interest', 'exam', 'career', 'circle', 'women'));
alter table public.groups add column if not exists women_only boolean not null default false;
alter table public.groups add column if not exists career_slug text;
alter table public.groups add column if not exists exam_slug text;
alter table public.groups add column if not exists state text;
alter table public.groups add column if not exists district text;
alter table public.groups alter column district_id drop not null;
alter table public.posts alter column group_id drop not null;
alter table public.posts add column if not exists kind text not null default 'post'
  check (kind in ('post', 'question', 'opportunity', 'story', 'resource'));
alter table public.posts add column if not exists tags jsonb not null default '{}'::jsonb;
alter table public.posts add column if not exists deadline date;
alter table public.posts add column if not exists link text;
alter table public.posts add column if not exists district text;
alter table public.posts add column if not exists answer_count integer not null default 0;
alter table public.posts add column if not exists score integer not null default 0;
alter table public.comments add column if not exists is_accepted boolean not null default false;
create index if not exists posts_kind_idx on public.posts (kind, created_at desc);
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists is_senior boolean not null default false;  -- willing to guide juniors
alter table public.profiles add column if not exists senior_path text;  -- e.g. "ITI Electrician → apprentice at MSEB"

-- ---------- Access ----------
alter table public.programs enable row level security;
alter table public.resources enable row level security;
alter table public.colleges enable row level security;
alter table public.saved_careers enable row level security;
alter table public.assistant_threads enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.search_cache enable row level security;

create policy "programs public" on public.programs for select using (true);
create policy "resources public" on public.resources for select using (true);
create policy "colleges public" on public.colleges for select using (true);
create policy "read own saved careers" on public.saved_careers for select using (user_id = (select auth.uid()));
create policy "read own threads" on public.assistant_threads for select using (user_id = (select auth.uid()));
create policy "read own messages" on public.assistant_messages for select
  using (exists (select 1 from public.assistant_threads t where t.id = thread_id and t.user_id = (select auth.uid())));

grant select on public.programs, public.resources, public.colleges to anon, authenticated;
grant select on public.saved_careers, public.assistant_threads, public.assistant_messages to authenticated;
grant all on public.programs, public.resources, public.colleges, public.saved_careers,
  public.assistant_threads, public.assistant_messages, public.search_cache to service_role;
