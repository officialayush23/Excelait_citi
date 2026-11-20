-- Atomic merge of a student's facts. Several quick answers from one phone can arrive
-- at the same time; a row lock makes each merge see the previous one, so none is lost.
create or replace function public.merge_student_facts(
  p_user uuid, p_set jsonb, p_remove text[] default '{}', p_append_lists boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cur jsonb;
  k text;
begin
  insert into student_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select facts into cur from student_profiles where user_id = p_user for update;
  if p_append_lists then
    foreach k in array array['interests', 'subjects'] loop
      if p_set ? k and cur ? k then
        p_set := jsonb_set(p_set, array[k], (
          select coalesce(jsonb_agg(v order by first), '[]'::jsonb)
          from (select v, min(o) as first from jsonb_array_elements(cur -> k || p_set -> k) with ordinality as e(v, o) group by v) d));
      end if;
    end loop;
  end if;
  cur := (cur || p_set) - p_remove;
  update student_profiles set facts = cur, updated_at = now() where user_id = p_user;
  return cur;
end $$;

revoke all on function public.merge_student_facts(uuid, jsonb, text[], boolean) from public, anon, authenticated;
grant execute on function public.merge_student_facts(uuid, jsonb, text[], boolean) to service_role;
