-- ExcelAIt 0018: the adaptive roadmap.
-- One roadmap per student, made of goals. A goal is a row in pathways (existing plans become career goals);
-- its steps stay in pathway_steps, with status, progress, sub-tasks, hard deadlines and links.
-- activity_events feed evidence-based progress; roadmap_changes is the student-visible changelog (with undo);
-- roadmap_signals hold what the student told Saathi (worry, time, money); watches drive daily alerts.
-- Fixed rules in the backend decide every date and status; nothing here is written by a model.

-- ---------- Goals (pathways) ----------
alter table public.pathways add column if not exists kind text not null default 'career';
alter table public.pathways drop constraint if exists pathways_kind_check;
alter table public.pathways add constraint pathways_kind_check
  check (kind in ('career', 'program', 'exam', 'scheme', 'job', 'custom'));
alter table public.pathways add column if not exists program_slug text;
alter table public.pathways add column if not exists exam_slug text;
alter table public.pathways add column if not exists scheme_slug text;
alter table public.pathways add column if not exists target_date date;
alter table public.pathways add column if not exists target_text text;          -- e.g. "earn ₹8k/month by June"
alter table public.pathways add column if not exists priority smallint not null default 0;
alter table public.pathways add column if not exists source text not null default 'student'
  check (source in ('student', 'saathi', 'migrated'));
alter table public.pathways add column if not exists updated_at timestamptz not null default now();
-- Rows that existed before this migration are the old career plans.
update public.pathways set source = 'migrated' where source = 'student' and created_at < now();
create index if not exists pathways_user_status_idx on public.pathways (user_id, status);

-- ---------- Steps ----------
alter table public.pathway_steps drop constraint if exists pathway_steps_kind_check;
alter table public.pathway_steps add constraint pathway_steps_kind_check
  check (kind in ('skill', 'course', 'exam', 'task', 'lesson', 'program', 'scheme', 'document', 'college', 'milestone',
                  'opportunity', 'micro', 'stretch', 'job', 'custom', 'community'));
alter table public.pathway_steps add column if not exists status text not null default 'todo';
alter table public.pathway_steps drop constraint if exists pathway_steps_status_check;
alter table public.pathway_steps add constraint pathway_steps_status_check
  check (status in ('todo', 'doing', 'done', 'skipped', 'blocked'));
alter table public.pathway_steps add column if not exists progress smallint not null default 0
  check (progress between 0 and 100);
alter table public.pathway_steps add column if not exists subtasks jsonb not null default '[]'::jsonb;   -- [{id, key, title, done}]
alter table public.pathway_steps add column if not exists hard_deadline boolean not null default false;
alter table public.pathway_steps add column if not exists at_risk boolean not null default false;
alter table public.pathway_steps add column if not exists refs jsonb not null default '[]'::jsonb;       -- [{kind, slug}]
alter table public.pathway_steps add column if not exists why text;
alter table public.pathway_steps add column if not exists now_text text;
alter table public.pathway_steps add column if not exists copy_key text;                               -- i18n key for why / now
alter table public.pathway_steps add column if not exists optional boolean not null default false;
alter table public.pathway_steps add column if not exists origin text not null default 'plan'
  check (origin in ('plan', 'adapt', 'saathi', 'student'));
alter table public.pathway_steps add column if not exists parent_step_id uuid references public.pathway_steps (id) on delete cascade;
alter table public.pathway_steps add column if not exists original_due_date date;
alter table public.pathway_steps add column if not exists done_by text check (done_by in ('student', 'evidence'));
alter table public.pathway_steps add column if not exists evidence jsonb;                              -- {kind, ref, at}
alter table public.pathway_steps add column if not exists updated_at timestamptz not null default now();

-- Existing plans: done steps stay done, real dates become hard deadlines.
update public.pathway_steps set status = 'done', progress = 100, done_by = 'student'
  where done_at is not null and status = 'todo';
-- exam windows, scheme deadlines, admissions, board exams and the legal age gate are real-world dates
update public.pathway_steps set hard_deadline = true
  where kind in ('exam', 'scheme', 'program', 'milestone') and due_date is not null and hard_deadline = false;
update public.pathway_steps set original_due_date = due_date where original_due_date is null and due_date is not null;
update public.pathway_steps set refs = jsonb_build_array(jsonb_build_object('kind', case when kind = 'course' then 'resource' else kind end, 'slug', ref_id))
  where ref_id is not null and refs = '[]'::jsonb and kind in ('exam', 'program', 'scheme', 'document', 'course');

-- ---------- Roadmap state (one per student) ----------
create table if not exists public.roadmap_state (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  pace              text not null default 'new' check (pace in ('new', 'on_track', 'ahead', 'behind', 'inactive', 'done')),
  tone              text not null default 'neutral',
  last_active_at    timestamptz,
  last_evaluated_at timestamptz,
  fresh_start_at    timestamptz,
  prefs             jsonb not null default '{}'::jsonb,   -- {gap_days, days: ['sun']}
  updated_at        timestamptz not null default now()
);

-- ---------- Activity events ----------
create table if not exists public.activity_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in (
               'lesson_completed', 'quiz_done', 'riasec_done', 'fact_answered', 'scheme_viewed', 'scheme_applied',
               'document_uploaded', 'career_saved', 'plan_step_toggled', 'credential_issued', 'task_submitted',
               'community_post', 'community_answer', 'saathi_turn', 'job_viewed', 'exam_viewed', 'roadmap_opened')),
  ref        text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_events_user_idx on public.activity_events (user_id, created_at desc);

-- ---------- Changelog (every automatic change, with a reason and undo) ----------
create table if not exists public.roadmap_changes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  goal_id     uuid references public.pathways (id) on delete cascade,
  step_id     uuid references public.pathway_steps (id) on delete set null,
  kind        text not null,               -- split | respace | stretch | pull_in | fresh_start | at_risk | evidence | reorder | goal_added | watch_added
  reason_code text not null,               -- i18n key roadmap.reason.<code>
  reason      text not null,               -- plain English fallback
  params      jsonb not null default '{}'::jsonb,
  before      jsonb not null default '[]'::jsonb,   -- [{id, due_date, position, status, progress}]
  created_ids uuid[] not null default '{}',
  auto        boolean not null default true,
  undone_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists roadmap_changes_user_idx on public.roadmap_changes (user_id, created_at desc);

-- ---------- Signals from conversation ----------
create table if not exists public.roadmap_signals (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('goal', 'worry', 'constraint', 'time', 'mood', 'money')),
  value      text not null,
  detail     jsonb not null default '{}'::jsonb,
  source     text not null default 'saathi' check (source in ('saathi', 'student')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 days')
);
create index if not exists roadmap_signals_user_idx on public.roadmap_signals (user_id, created_at desc);

-- ---------- Watches ----------
create table if not exists public.watches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('job', 'exam', 'scheme', 'skill')),
  ref             text not null,            -- exam / scheme slug, or a normalised job query
  query           jsonb not null default '{}'::jsonb,   -- {role, place, state, apprenticeship}
  label           text,
  active          boolean not null default true,
  last_checked_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (user_id, kind, ref)
);
create index if not exists watches_active_idx on public.watches (active, kind);

-- ---------- Notifications: one alert per reason ----------
alter table public.notifications add column if not exists dedupe_key text;
-- Plain unique index (NULL keys never clash), so the backend can upsert with on_conflict=user_id,dedupe_key.
create unique index if not exists notifications_dedupe_idx on public.notifications (user_id, dedupe_key);

-- ---------- Access: students read their own rows; the backend writes ----------
alter table public.roadmap_state enable row level security;
alter table public.activity_events enable row level security;
alter table public.roadmap_changes enable row level security;
alter table public.roadmap_signals enable row level security;
alter table public.watches enable row level security;

create policy "read own roadmap state" on public.roadmap_state for select to authenticated using (user_id = (select auth.uid()));
create policy "read own events" on public.activity_events for select to authenticated using (user_id = (select auth.uid()));
create policy "read own roadmap changes" on public.roadmap_changes for select to authenticated using (user_id = (select auth.uid()));
create policy "read own roadmap signals" on public.roadmap_signals for select to authenticated using (user_id = (select auth.uid()));
create policy "read own watches" on public.watches for select to authenticated using (user_id = (select auth.uid()));

grant select on public.roadmap_state, public.activity_events, public.roadmap_changes, public.roadmap_signals, public.watches to authenticated;
grant all on public.roadmap_state, public.activity_events, public.roadmap_changes, public.roadmap_signals, public.watches to service_role;
