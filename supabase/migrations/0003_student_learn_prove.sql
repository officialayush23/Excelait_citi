-- ExcelAIt 0003: student profile, discover, learn, prove.
-- Writes go through the FastAPI backend; the browser may read its own rows.

create table public.student_profiles (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  stage               public.student_stage not null default 'school',
  class_level         smallint check (class_level between 6 and 16),
  stream              text,
  board               text,
  marks_percent       numeric(5, 2) check (marks_percent between 0 and 100),
  interests           text[] not null default '{}',
  skills              text[] not null default '{}',
  subjects_liked      text[] not null default '{}',
  goals               text,
  can_relocate        boolean,
  needs_income_soon   boolean,
  family_income_band  text,          -- e.g. 'lt_1_5l', '1_5l_2_5l', '2_5l_8l', 'gt_8l'
  social_category     text,          -- used only for scheme eligibility, never shown to others
  is_disabled         boolean,
  is_minority         boolean,
  is_first_generation boolean,
  school_name         text,
  updated_at          timestamptz not null default now()
);
create trigger student_profiles_updated_at before update on public.student_profiles
  for each row execute function public.set_updated_at();

create table public.interest_results (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  activity   text not null,
  scores     jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.interest_results (user_id);

create table public.career_matches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  career_id   bigint not null references public.careers (id) on delete cascade,
  score       numeric(5, 2) not null,
  reasons     jsonb not null default '[]'::jsonb,   -- [{code, points, text}]
  gaps        jsonb not null default '[]'::jsonb,
  what_if     jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  unique (user_id, career_id)
);
create index on public.career_matches (career_id);

create table public.pathways (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  career_id  bigint references public.careers (id) on delete set null,
  title      text not null,
  status     text not null default 'active' check (status in ('active', 'paused', 'done')),
  created_at timestamptz not null default now()
);
create index on public.pathways (user_id);
create index on public.pathways (career_id);

create table public.pathway_steps (
  id         uuid primary key default gen_random_uuid(),
  pathway_id uuid not null references public.pathways (id) on delete cascade,
  position   smallint not null,
  kind       text not null check (kind in ('skill', 'course', 'exam', 'task', 'lesson')),
  ref_id     text,
  title      text not null,
  detail     text,
  due_date   date,
  done_at    timestamptz
);
create index on public.pathway_steps (pathway_id);

-- ---------- Learn ----------
create table public.modules (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  description text,
  language    text not null default 'en',
  pricing     text not null default 'free' check (pricing in ('free', 'per_module', 'subscription')),
  price_inr   integer not null default 0 check (price_inr >= 0),
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at  timestamptz not null default now()
);
create index on public.modules (owner_id);

create table public.lessons (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  module_id       uuid references public.modules (id) on delete set null,
  title           text not null,
  language        text not null default 'en',
  source_pdf_path text,
  summary         text,
  body            text,
  status          text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  is_public       boolean not null default false,
  created_at      timestamptz not null default now()
);
create index on public.lessons (owner_id);
create index on public.lessons (module_id);

create table public.lesson_assets (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons (id) on delete cascade,
  kind         text not null check (kind in ('audio', 'transcript', 'image')),
  storage_path text not null,
  language     text not null default 'en',
  created_at   timestamptz not null default now()
);
create index on public.lesson_assets (lesson_id);

create table public.flashcards (
  id        uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  front     text not null,
  back      text not null,
  position  smallint not null default 0
);
create index on public.flashcards (lesson_id);

create table public.quizzes (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid references public.lessons (id) on delete cascade,
  title      text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.quizzes (lesson_id);
create index on public.quizzes (created_by);

create table public.quiz_questions (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references public.quizzes (id) on delete cascade,
  prompt       text not null,
  options      jsonb not null,
  answer_index smallint not null,
  explanation  text,
  difficulty   smallint not null default 2 check (difficulty between 1 and 3),
  position     smallint not null default 0
);
create index on public.quiz_questions (quiz_id);

create table public.quiz_attempts (
  id         uuid primary key default gen_random_uuid(),
  quiz_id    uuid not null references public.quizzes (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  score      numeric(5, 2) not null,
  answers    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.quiz_attempts (quiz_id);
create index on public.quiz_attempts (user_id);

create table public.module_enrollments (
  module_id  uuid not null references public.modules (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (module_id, user_id)
);
create index on public.module_enrollments (user_id);

create table public.module_purchases (
  id           uuid primary key default gen_random_uuid(),
  module_id    uuid not null references public.modules (id) on delete cascade,
  buyer_id     uuid not null references public.profiles (id) on delete cascade,
  amount_inr   integer not null,
  is_simulated boolean not null default true,
  created_at   timestamptz not null default now()
);
create index on public.module_purchases (module_id);
create index on public.module_purchases (buyer_id);

-- ---------- Prove ----------
create table public.rubrics (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  criteria   jsonb not null,           -- [{name, levels:[...]}]
  created_at timestamptz not null default now()
);

create table public.skill_tasks (
  id           uuid primary key default gen_random_uuid(),
  skill_id     bigint not null references public.skills (id) on delete cascade,
  rubric_id    uuid references public.rubrics (id) on delete set null,
  title        text not null,
  instructions text not null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.skill_tasks (skill_id);
create index on public.skill_tasks (rubric_id);
create index on public.skill_tasks (created_by);

create table public.task_submissions (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.skill_tasks (id) on delete cascade,
  student_id     uuid not null references public.profiles (id) on delete cascade,
  evidence_paths text[] not null default '{}',
  note           text,
  status         text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'resubmit')),
  reviewer_id    uuid references public.profiles (id) on delete set null,
  review         jsonb,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index on public.task_submissions (task_id);
create index on public.task_submissions (student_id);
create index on public.task_submissions (reviewer_id);

create table public.credentials (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.profiles (id) on delete cascade,
  submission_id uuid references public.task_submissions (id) on delete set null,
  skill_id      bigint references public.skills (id) on delete set null,
  payload       jsonb not null,          -- W3C VC-style JSON
  signature     text not null,           -- Ed25519, base64url
  public_id     text not null unique,    -- used in the public verify URL / QR
  issued_at     timestamptz not null default now(),
  revoked_at    timestamptz
);
create index on public.credentials (student_id);
create index on public.credentials (submission_id);
create index on public.credentials (skill_id);

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array[
    'student_profiles', 'interest_results', 'career_matches', 'pathways', 'pathway_steps',
    'modules', 'lessons', 'lesson_assets', 'flashcards', 'quizzes', 'quiz_questions',
    'quiz_attempts', 'module_enrollments', 'module_purchases', 'rubrics', 'skill_tasks',
    'task_submissions', 'credentials'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "read own student profile" on public.student_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own interest results" on public.interest_results
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own career matches" on public.career_matches
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own pathways" on public.pathways
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own pathway steps" on public.pathway_steps
  for select to authenticated using (
    exists (select 1 from public.pathways p where p.id = pathway_id and p.user_id = (select auth.uid())));

create policy "read published or own modules" on public.modules
  for select to authenticated using (status = 'published' or owner_id = (select auth.uid()));
create policy "read public or own lessons" on public.lessons
  for select to authenticated using (is_public or owner_id = (select auth.uid()));
create policy "read assets of visible lessons" on public.lesson_assets
  for select to authenticated using (
    exists (select 1 from public.lessons l where l.id = lesson_id
            and (l.is_public or l.owner_id = (select auth.uid()))));
create policy "read flashcards of visible lessons" on public.flashcards
  for select to authenticated using (
    exists (select 1 from public.lessons l where l.id = lesson_id
            and (l.is_public or l.owner_id = (select auth.uid()))));
create policy "read quizzes" on public.quizzes
  for select to authenticated using (true);
-- quiz_questions hold answers: served by the backend only.
create policy "read own quiz attempts" on public.quiz_attempts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own enrollments" on public.module_enrollments
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own purchases" on public.module_purchases
  for select to authenticated using (buyer_id = (select auth.uid()));
create policy "read rubrics" on public.rubrics
  for select to authenticated using (true);
create policy "read skill tasks" on public.skill_tasks
  for select to authenticated using (true);
create policy "read own submissions" on public.task_submissions
  for select to authenticated using (student_id = (select auth.uid()) or reviewer_id = (select auth.uid()));
-- credentials: anyone can verify a non-revoked credential by public_id through the backend;
-- the owner can list their own.
create policy "read own credentials" on public.credentials
  for select to authenticated using (student_id = (select auth.uid()));
