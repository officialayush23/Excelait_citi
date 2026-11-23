-- Where each student fact came from: the "knowledge graph" the profile page shows.
-- facts_meta is keyed like facts: {"age": {"source": "saathi", "at": "2026-11-23T10:00:00Z", "note": "main 15 saal ka hoon"}}
-- source is one of onboarding | saathi | teacher | quiz | system; note is the chat excerpt for Saathi.
alter table public.student_profiles add column if not exists facts_meta jsonb not null default '{}'::jsonb;

-- Same merge as 0008, plus provenance. The old 4-argument function is replaced (not overloaded) so
-- callers that pass only p_user, p_set, p_remove and p_append_lists keep working unchanged.
-- Lists that grow on merge now include skills, as the app already treats them.
drop function if exists public.merge_student_facts(uuid, jsonb, text[], boolean);

create or replace function public.merge_student_facts(
  p_user uuid, p_set jsonb, p_remove text[] default '{}', p_append_lists boolean default true, p_meta jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cur jsonb;
  meta jsonb;
  k text;
begin
  insert into student_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select facts, coalesce(facts_meta, '{}'::jsonb) into cur, meta from student_profiles where user_id = p_user for update;
  if p_append_lists then
    foreach k in array array['interests', 'subjects', 'skills'] loop
      if p_set ? k and cur ? k then
        p_set := jsonb_set(p_set, array[k], (
          select coalesce(jsonb_agg(v order by first), '[]'::jsonb)
          from (select v, min(o) as first from jsonb_array_elements(cur -> k || p_set -> k) with ordinality as e(v, o) group by v) d));
      end if;
    end loop;
  end if;
  cur := (cur || p_set) - p_remove;
  -- Provenance only for keys that were actually set; a removed fact loses its provenance too.
  if p_meta is not null then
    meta := meta || (select coalesce(jsonb_object_agg(m.key, m.value), '{}'::jsonb) from jsonb_each(p_meta) m where p_set ? m.key);
  end if;
  meta := meta - p_remove;
  update student_profiles set facts = cur, facts_meta = meta, updated_at = now() where user_id = p_user;
  return cur;
end $$;

revoke all on function public.merge_student_facts(uuid, jsonb, text[], boolean, jsonb) from public, anon, authenticated;
grant execute on function public.merge_student_facts(uuid, jsonb, text[], boolean, jsonb) to service_role;
