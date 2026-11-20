-- ExcelAIt 0004: community, marketplace, earn, claim, facilitator, system, storage.

-- ---------- Community: Gyan Chaupal ----------
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  kind        text not null check (kind in ('district', 'school', 'interest', 'exam')),
  district_id bigint references public.districts (id) on delete set null,
  description text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.groups (district_id);
create index on public.groups (created_by);

create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('member', 'moderator')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index on public.group_members (user_id);

create table public.posts (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  body       text,
  audio_path text,
  transcript text,
  language   text not null default 'en',
  status     text not null default 'visible' check (status in ('visible', 'flagged', 'hidden')),
  created_at timestamptz not null default now()
);
create index on public.posts (group_id, created_at desc);
create index on public.posts (author_id);

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,  -- null for AI drafts
  body        text not null,
  audio_path  text,
  is_ai_draft boolean not null default false,
  sources     jsonb not null default '[]'::jsonb,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  status      text not null default 'visible' check (status in ('visible', 'pending', 'flagged', 'hidden')),
  created_at  timestamptz not null default now()
);
create index on public.comments (post_id, created_at);
create index on public.comments (author_id);
create index on public.comments (approved_by);

create table public.votes (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  target_kind text not null check (target_kind in ('post', 'comment')),
  target_id   uuid not null,
  value       smallint not null check (value in (-1, 1)),
  created_at  timestamptz not null default now(),
  primary key (user_id, target_kind, target_id)
);
create index on public.votes (target_kind, target_id);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_kind text not null check (target_kind in ('post', 'comment', 'opportunity', 'user')),
  target_id   uuid not null,
  reason      text not null,
  source      text not null default 'user' check (source in ('user', 'ai')),
  status      text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.reports (status, created_at);
create index on public.reports (reporter_id);
create index on public.reports (resolved_by);

create table public.mentor_sessions (
  id           uuid primary key default gen_random_uuid(),
  mentor_id    uuid not null references public.profiles (id) on delete cascade,
  group_id     uuid references public.groups (id) on delete set null,
  title        text not null,
  starts_at    timestamptz not null,
  duration_min smallint not null default 45,
  join_url     text,
  created_at   timestamptz not null default now()
);
create index on public.mentor_sessions (mentor_id);
create index on public.mentor_sessions (group_id);

-- ---------- Connect: marketplace ----------
create table public.organizations (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  kind                text not null check (kind in ('college', 'iti', 'ngo', 'company', 'msme', 'csr', 'government')),
  district_id         bigint references public.districts (id) on delete set null,
  website             text,
  about               text,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  verified_by         uuid references public.profiles (id) on delete set null,
  verified_at         timestamptz,
  document_paths      text[] not null default '{}',
  created_at          timestamptz not null default now()
);
create index on public.organizations (district_id);
create index on public.organizations (verified_by);

create table public.org_members (
  org_id   uuid not null references public.organizations (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  role     text not null default 'member' check (role in ('owner', 'member')),
  added_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on public.org_members (user_id);

create table public.opportunities (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.organizations (id) on delete cascade,
  kind            text not null check (kind in ('internship', 'apprenticeship', 'workshop', 'bootcamp', 'hackathon', 'admission', 'job', 'mentorship')),
  title           text not null,
  description     text,
  district_id     bigint references public.districts (id) on delete set null,
  location        text,
  is_remote       boolean not null default false,
  stipend_monthly integer,
  eligibility     jsonb not null default '{}'::jsonb,
  skills          text[] not null default '{}',
  deadline        date,
  starts_at       date,
  apply_url       text,
  status          text not null default 'open' check (status in ('draft', 'open', 'closed')),
  source          text not null default 'partner' check (source in ('partner', 'csv', 'api', 'seeded_govt')),
  created_at      timestamptz not null default now()
);
create index on public.opportunities (status, deadline);
create index on public.opportunities (org_id);
create index on public.opportunities (district_id);

create table public.applications (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.opportunities (id) on delete cascade,
  student_id      uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'applied' check (status in ('applied', 'shortlisted', 'interview', 'offered', 'joined', 'rejected', 'withdrawn')),
  credential_ids  uuid[] not null default '{}',
  note            text,
  teacher_confirmed_by uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (opportunity_id, student_id)
);
create trigger applications_updated_at before update on public.applications
  for each row execute function public.set_updated_at();
create index on public.applications (student_id);
create index on public.applications (teacher_confirmed_by);

create table public.application_events (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  status         text not null,
  actor_id       uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index on public.application_events (application_id);
create index on public.application_events (actor_id);

-- ---------- Earn: Kamao-Seekho ----------
create table public.micro_tasks (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('record', 'transcribe', 'translate_check', 'digitise')),
  language   text not null,
  prompt     text not null,
  payload    jsonb not null default '{}'::jsonb,
  reward_inr numeric(8, 2) not null check (reward_inr >= 0),
  status     text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.micro_tasks (status, language);
create index on public.micro_tasks (created_by);

create table public.micro_task_submissions (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.micro_tasks (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  payload     jsonb not null default '{}'::jsonb,
  audio_path  text,
  status      text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  reviewer_id uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.micro_task_submissions (task_id);
create index on public.micro_task_submissions (user_id);
create index on public.micro_task_submissions (reviewer_id);

-- Append-only. is_simulated stays true until Razorpay is connected.
create table public.earnings_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  amount_inr   numeric(10, 2) not null,
  kind         text not null check (kind in ('task', 'module_sale', 'payout', 'adjustment')),
  ref_id       uuid,
  note         text,
  is_simulated boolean not null default true,
  created_at   timestamptz not null default now()
);
create index on public.earnings_ledger (user_id, created_at desc);

-- ---------- Claim ----------
create table public.scheme_checks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  scheme_id      bigint not null references public.schemes (id) on delete cascade,
  rule_version   integer not null,
  result         public.eligibility_result not null,
  failed_rule    text,
  missing_fields text[] not null default '{}',
  computed_at    timestamptz not null default now(),
  unique (user_id, scheme_id)
);
create index on public.scheme_checks (scheme_id);

create table public.claims (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  scheme_id       bigint not null references public.schemes (id) on delete cascade,
  status          text not null default 'started' check (status in ('started', 'documents_ready', 'submitted', 'approved', 'money_received', 'rejected')),
  amount_expected integer,
  amount_received integer,
  confirmed_by    uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, scheme_id)
);
create trigger claims_updated_at before update on public.claims
  for each row execute function public.set_updated_at();
create index on public.claims (scheme_id);
create index on public.claims (confirmed_by);

create table public.claim_documents (
  id               uuid primary key default gen_random_uuid(),
  claim_id         uuid not null references public.claims (id) on delete cascade,
  document_type_id bigint not null references public.document_types (id) on delete cascade,
  storage_path     text not null,
  check_result     jsonb,
  created_at       timestamptz not null default now()
);
create index on public.claim_documents (claim_id);
create index on public.claim_documents (document_type_id);

-- ---------- Facilitator ----------
create table public.cohorts (
  id             uuid primary key default gen_random_uuid(),
  facilitator_id uuid not null references public.profiles (id) on delete cascade,
  name           text not null,
  school_name    text,
  district_id    bigint references public.districts (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index on public.cohorts (facilitator_id);
create index on public.cohorts (district_id);

create table public.cohort_members (
  cohort_id  uuid not null references public.cohorts (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (cohort_id, student_id)
);
create index on public.cohort_members (student_id);

create table public.risk_flags (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles (id) on delete cascade,
  cohort_id   uuid references public.cohorts (id) on delete cascade,
  reason_code text not null,
  detail      text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index on public.risk_flags (student_id);
create index on public.risk_flags (cohort_id);

create table public.recommendations (
  id             uuid primary key default gen_random_uuid(),
  facilitator_id uuid not null references public.profiles (id) on delete cascade,
  student_id     uuid not null references public.profiles (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  note           text,
  created_at     timestamptz not null default now(),
  unique (facilitator_id, student_id, opportunity_id)
);
create index on public.recommendations (student_id);
create index on public.recommendations (opportunity_id);

-- Is the current user the facilitator of a cohort this student belongs to?
create or replace function public.is_facilitator_of(target_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cohort_members m
    join public.cohorts c on c.id = m.cohort_id
    where m.student_id = target_student and c.facilitator_id = (select auth.uid())
  );
$$;

-- ---------- System ----------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.reminders (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles (id) on delete cascade,
  kind      text not null,
  ref_id    text,
  remind_at timestamptz not null,
  sent_at   timestamptz
);
create index on public.reminders (remind_at) where sent_at is null;
create index on public.reminders (user_id);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  target_kind text,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index on public.audit_log (actor_id);
create index on public.audit_log (created_at desc);

-- Offline sync: each queued write carries a client op id, applied at most once.
create table public.sync_ops (
  op_id      uuid primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  entity     text not null,
  payload    jsonb not null,
  applied_at timestamptz not null default now()
);
create index on public.sync_ops (user_id);

create table public.api_keys (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  key_hash   text not null unique,
  label      text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index on public.api_keys (org_id);

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array[
    'groups', 'group_members', 'posts', 'comments', 'votes', 'reports', 'mentor_sessions',
    'organizations', 'org_members', 'opportunities', 'applications', 'application_events',
    'micro_tasks', 'micro_task_submissions', 'earnings_ledger', 'scheme_checks', 'claims',
    'claim_documents', 'cohorts', 'cohort_members', 'risk_flags', 'recommendations',
    'notifications', 'reminders', 'audit_log', 'sync_ops', 'api_keys'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "groups readable by members of the platform" on public.groups
  for select to authenticated using (true);
create policy "read own memberships" on public.group_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "visible posts readable" on public.posts
  for select to authenticated using (status = 'visible' or author_id = (select auth.uid()));
create policy "visible comments readable" on public.comments
  for select to authenticated using (status = 'visible' or author_id = (select auth.uid()));
create policy "read own votes" on public.votes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own reports" on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()));
create policy "sessions readable" on public.mentor_sessions
  for select to authenticated using (true);

create policy "verified orgs readable, members see their own" on public.organizations
  for select to authenticated using (
    verification_status = 'verified'
    or exists (select 1 from public.org_members m where m.org_id = organizations.id and m.user_id = (select auth.uid())));
create policy "read own org memberships" on public.org_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "open opportunities readable" on public.opportunities
  for select to anon, authenticated using (status = 'open');
create policy "student reads own applications" on public.applications
  for select to authenticated using (student_id = (select auth.uid()));
create policy "student reads own application events" on public.application_events
  for select to authenticated using (
    exists (select 1 from public.applications a where a.id = application_id and a.student_id = (select auth.uid())));

create policy "open micro tasks readable" on public.micro_tasks
  for select to authenticated using (status = 'open');
create policy "read own micro task submissions" on public.micro_task_submissions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own earnings" on public.earnings_ledger
  for select to authenticated using (user_id = (select auth.uid()));

create policy "read own scheme checks" on public.scheme_checks
  for select to authenticated using (user_id = (select auth.uid()));
create policy "student or facilitator reads claims" on public.claims
  for select to authenticated using (
    user_id = (select auth.uid()) or (select public.is_facilitator_of(user_id)));
create policy "read own claim documents" on public.claim_documents
  for select to authenticated using (
    exists (select 1 from public.claims c where c.id = claim_id and c.user_id = (select auth.uid())));

create policy "facilitator reads own cohorts" on public.cohorts
  for select to authenticated using (facilitator_id = (select auth.uid()));
create policy "facilitator or student reads cohort membership" on public.cohort_members
  for select to authenticated using (
    student_id = (select auth.uid())
    or exists (select 1 from public.cohorts c where c.id = cohort_id and c.facilitator_id = (select auth.uid())));
create policy "facilitator reads risk flags" on public.risk_flags
  for select to authenticated using (
    exists (select 1 from public.cohorts c where c.id = cohort_id and c.facilitator_id = (select auth.uid())));
create policy "recommendations visible to both sides" on public.recommendations
  for select to authenticated using (
    facilitator_id = (select auth.uid()) or student_id = (select auth.uid()));

create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own reminders" on public.reminders
  for select to authenticated using (user_id = (select auth.uid()));
-- audit_log, sync_ops, api_keys: backend only.

-- ---------- Storage buckets ----------
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('avatars', 'avatars', true, 2097152),
  ('lesson-pdfs', 'lesson-pdfs', false, 20971520),
  ('lesson-audio', 'lesson-audio', false, 20971520),
  ('community-audio', 'community-audio', false, 10485760),
  ('evidence', 'evidence', false, 52428800),
  ('claim-documents', 'claim-documents', false, 10485760),
  ('org-documents', 'org-documents', false, 10485760)
on conflict (id) do nothing;
-- Uploads go through the backend (signed upload URLs), so no storage.objects
-- policies are granted to browser roles here.
