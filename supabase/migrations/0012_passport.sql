-- ExcelAIt 0012: Skill Passport (Prove). Stable slugs for idempotent seeding, task steps,
-- one credential per approved submission, and review-queue indexes.

alter table public.skills add column if not exists summary text;

alter table public.rubrics add column if not exists slug text;
create unique index if not exists rubrics_slug_key on public.rubrics (slug);

alter table public.skill_tasks add column if not exists slug text;
alter table public.skill_tasks add column if not exists title_i18n jsonb not null default '{}'::jsonb;
alter table public.skill_tasks add column if not exists steps jsonb not null default '[]'::jsonb;     -- ["step 1", ...]
alter table public.skill_tasks add column if not exists evidence_hint text;
create unique index if not exists skill_tasks_slug_key on public.skill_tasks (slug);

-- A submission can produce at most one credential.
create unique index if not exists credentials_one_per_submission
  on public.credentials (submission_id) where submission_id is not null;

-- Review queue and "my submissions" lookups.
create index if not exists task_submissions_status_idx on public.task_submissions (status, created_at);
create index if not exists task_submissions_student_task_idx on public.task_submissions (student_id, task_id);
