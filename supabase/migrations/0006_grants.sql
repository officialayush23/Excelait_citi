-- ExcelAIt 0006: table privileges.
-- This project does not auto-grant new tables to the API roles, so grant explicitly.
-- Privileges say which tables a role may touch; RLS policies still decide which rows.

grant usage on schema public to anon, authenticated, service_role;

-- Backend (secret key) does all writes.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Signed-in users may read; RLS limits them to rows they are allowed to see,
-- and tables without a policy (api_keys, audit_log, quiz_questions, kb_chunks,
-- scheme_sources, shared_phone_profiles, sync_ops) stay closed.
grant select on all tables in schema public to authenticated;

-- The only direct browser write: a user editing their own profile basics.
grant update (full_name, phone, preferred_language, district_id, state, avatar_url) on public.profiles to authenticated;

-- Public catalogue for signed-out visitors.
grant select on
  public.districts, public.careers, public.skills, public.career_skills, public.district_demand,
  public.exams, public.courses, public.career_exams, public.career_courses, public.schemes,
  public.scheme_rules, public.document_types, public.scheme_documents, public.kb_sources,
  public.opportunities
to anon;

-- Future tables follow the same pattern.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant select on tables to authenticated;
