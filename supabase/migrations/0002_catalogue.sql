-- ExcelAIt 0002: catalogue (careers, skills, exams, courses), schemes and rules, knowledge base.
-- Catalogue rows are public reads; only the backend (secret key) writes them.

create table public.careers (
  id           bigint generated always as identity primary key,
  slug         text not null unique,
  name         text not null,
  name_i18n    jsonb not null default '{}'::jsonb,   -- {"hi": "...", "mr": "..."}
  summary      text,
  summary_i18n jsonb not null default '{}'::jsonb,
  category     public.career_category not null,
  nco_code     text,                                -- National Classification of Occupations
  nsqf_level   smallint check (nsqf_level between 1 and 10),
  pay_min      integer,                             -- indicative monthly INR
  pay_max      integer,
  pay_note     text,
  min_education text,
  earning_speed text check (earning_speed in ('fast', 'medium', 'slow')),
  cost_band    text check (cost_band in ('low', 'medium', 'high')),
  interest_tags text[] not null default '{}',
  subject_tags  text[] not null default '{}',
  path         jsonb not null default '[]'::jsonb,  -- ordered steps
  source_url   text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger careers_updated_at before update on public.careers
  for each row execute function public.set_updated_at();
create index careers_name_trgm on public.careers using gin (name extensions.gin_trgm_ops);

create table public.skills (
  id         bigint generated always as identity primary key,
  slug       text not null unique,
  name       text not null,
  name_i18n  jsonb not null default '{}'::jsonb,
  nsqf_level smallint,
  created_at timestamptz not null default now()
);

create table public.career_skills (
  career_id  bigint not null references public.careers (id) on delete cascade,
  skill_id   bigint not null references public.skills (id) on delete cascade,
  importance smallint not null default 3 check (importance between 1 and 5),
  primary key (career_id, skill_id)
);
create index on public.career_skills (skill_id);

create table public.district_demand (
  id           bigint generated always as identity primary key,
  district_id  bigint not null references public.districts (id) on delete cascade,
  career_id    bigint not null references public.careers (id) on delete cascade,
  demand_score smallint not null check (demand_score between 0 and 100),
  source_url   text,
  as_of        date,
  unique (district_id, career_id)
);
create index on public.district_demand (career_id);

create table public.exams (
  id              bigint generated always as identity primary key,
  slug            text not null unique,
  name            text not null,
  conducting_body text,
  eligibility     text,
  typical_months  smallint[] not null default '{}',
  official_url    text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.courses (
  id          bigint generated always as identity primary key,
  provider    text not null,       -- DIKSHA, SWAYAM, NPTEL, Skill India Digital Hub, ...
  title       text not null,
  url         text not null,
  language    text,
  duration    text,
  nsqf_level  smallint,
  is_free     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (provider, url)
);

create table public.career_exams (
  career_id bigint not null references public.careers (id) on delete cascade,
  exam_id   bigint not null references public.exams (id) on delete cascade,
  primary key (career_id, exam_id)
);
create index on public.career_exams (exam_id);

create table public.career_courses (
  career_id bigint not null references public.careers (id) on delete cascade,
  course_id bigint not null references public.courses (id) on delete cascade,
  primary key (career_id, course_id)
);
create index on public.career_courses (course_id);

-- ---------- schemes ----------
create table public.schemes (
  id               bigint generated always as identity primary key,
  slug             text not null unique,
  name             text not null,
  name_i18n        jsonb not null default '{}'::jsonb,
  summary          text,
  summary_i18n     jsonb not null default '{}'::jsonb,
  kind             public.scheme_kind not null,
  level            text not null check (level in ('central', 'state')),
  state            text,
  ministry         text,
  benefit_amount   integer,            -- INR per year where a single figure applies
  benefit_text     text,
  official_url     text not null,
  apply_url        text,
  deadline         date,
  last_verified_at timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger schemes_updated_at before update on public.schemes
  for each row execute function public.set_updated_at();
create index schemes_name_trgm on public.schemes using gin (name extensions.gin_trgm_ops);

-- One JSON rule per scheme version; the same JSON is evaluated by the TS (phone)
-- and Python (server) engines.
create table public.scheme_rules (
  id          bigint generated always as identity primary key,
  scheme_id   bigint not null references public.schemes (id) on delete cascade,
  version     integer not null,
  rule        jsonb not null,
  source_url  text not null,
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (scheme_id, version)
);
create unique index scheme_rules_one_current on public.scheme_rules (scheme_id) where is_current;
create index on public.scheme_rules (verified_by);

create table public.document_types (
  id         bigint generated always as identity primary key,
  slug       text not null unique,
  name       text not null,
  name_i18n  jsonb not null default '{}'::jsonb,
  how_to_get text,
  issued_by  text
);

create table public.scheme_documents (
  scheme_id        bigint not null references public.schemes (id) on delete cascade,
  document_type_id bigint not null references public.document_types (id) on delete cascade,
  required         boolean not null default true,
  primary key (scheme_id, document_type_id)
);
create index on public.scheme_documents (document_type_id);

-- Crawler bookkeeping: what each official page looked like when last fetched.
create table public.scheme_sources (
  id            bigint generated always as identity primary key,
  scheme_id     bigint references public.schemes (id) on delete set null,
  url           text not null unique,
  content_hash  text,
  last_fetched_at timestamptz,
  last_changed_at timestamptz,
  status        text not null default 'ok' check (status in ('ok', 'changed', 'error', 'new')),
  notes         text
);
create index on public.scheme_sources (scheme_id);

-- ---------- knowledge base (grounded, cited answers) ----------
create table public.kb_sources (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('scheme', 'career', 'exam', 'course', 'faq', 'lesson')),
  title      text not null,
  url        text,
  language   text not null default 'en',
  fetched_at timestamptz,
  created_at timestamptz not null default now()
);

-- 768 dims matches nomic-embed-text (Ollama); change with a migration if the model changes.
create table public.kb_chunks (
  id         bigint generated always as identity primary key,
  source_id  bigint not null references public.kb_sources (id) on delete cascade,
  content    text not null,
  language   text not null default 'en',
  embedding  extensions.vector(768),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.kb_chunks (source_id);
create index kb_chunks_embedding on public.kb_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------- RLS: public read, backend write ----------
do $$
declare t text;
begin
  foreach t in array array[
    'careers', 'skills', 'career_skills', 'district_demand', 'exams', 'courses',
    'career_exams', 'career_courses', 'schemes', 'scheme_rules', 'document_types',
    'scheme_documents', 'kb_sources'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "catalogue readable by everyone" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

alter table public.scheme_sources enable row level security;  -- backend only
alter table public.kb_chunks enable row level security;       -- backend only
