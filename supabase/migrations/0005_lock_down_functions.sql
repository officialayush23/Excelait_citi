-- ExcelAIt 0005: security-definer helpers are not callable by anonymous users.
-- handle_new_user only runs from the auth trigger; has_role / is_facilitator_of
-- are needed by RLS policies for signed-in users and only reveal the caller's own access.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.has_role(public.app_role) from public, anon;
revoke execute on function public.is_facilitator_of(uuid) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated;
grant execute on function public.is_facilitator_of(uuid) to authenticated;
