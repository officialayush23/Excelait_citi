-- ExcelAIt 0013: Career Mitra (teacher) side.
-- 1) A short, readable join code per class. Alphabet has no I, L, O, 0 or 1 so it can be read aloud.
-- 2) Recommendations can be a free-form teacher note (no opportunity needed), with a title and link.
-- claims.status already allows started / documents_ready / submitted / approved / money_received / rejected,
-- so no change is needed there ("received" in the UI = money_received).

create or replace function public.gen_cohort_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.cohorts where join_code = code);
  end loop;
  return code;
end $$;
revoke all on function public.gen_cohort_code() from public, anon, authenticated;
grant execute on function public.gen_cohort_code() to service_role;

alter table public.cohorts add column if not exists join_code text;
update public.cohorts set join_code = public.gen_cohort_code() where join_code is null;
alter table public.cohorts alter column join_code set default public.gen_cohort_code();
alter table public.cohorts alter column join_code set not null;
alter table public.cohorts drop constraint if exists cohorts_join_code_format;
alter table public.cohorts add constraint cohorts_join_code_format check (join_code ~ '^[A-HJ-KM-NP-Z2-9]{6}$');
create unique index if not exists cohorts_join_code_key on public.cohorts (join_code);

-- Teacher recommendations: an opportunity is now optional.
alter table public.recommendations alter column opportunity_id drop not null;
alter table public.recommendations add column if not exists title text;
alter table public.recommendations add column if not exists link text;
alter table public.recommendations
  drop constraint if exists recommendations_facilitator_id_student_id_opportunity_id_key;
create unique index if not exists recommendations_unique_opportunity
  on public.recommendations (facilitator_id, student_id, opportunity_id) where opportunity_id is not null;
alter table public.recommendations drop constraint if exists recommendations_has_content;
alter table public.recommendations add constraint recommendations_has_content
  check (opportunity_id is not null or coalesce(btrim(note), '') <> '');
