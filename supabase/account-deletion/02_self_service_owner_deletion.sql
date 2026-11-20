-- Self-service account deletion for owners, 2026-11-19.
-- This migration does not delete any account or existing user data.
-- The existing delete_my_account() remains the default for ordinary users.
-- An owner must explicitly confirm permanent deletion of shared content.
create or replace function public.account_deletion_impact()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  owned_networks integer;
  owned_checklists integer;
  attributed_progress integer;
begin
  if uid is null or auth.role() <> 'authenticated' then
    raise exception 'Sign in to inspect your account' using errcode = '28000';
  end if;
  select count(*) into owned_networks from public.networks where created_by = uid;
  select count(*) into owned_checklists from public.mawl_checklists where created_by = uid
    and network_id not in (select id from public.networks where created_by = uid);
  select count(*) into attributed_progress from public.mawl_progress where updated_by = uid
    and checklist_id not in (
      select id from public.mawl_checklists where created_by = uid
         or network_id in (select id from public.networks where created_by = uid)
    );
  return pg_catalog.jsonb_build_object(
    'owned_networks', owned_networks,
    'owned_checklists', owned_checklists,
    'other_progress', attributed_progress
  );
end;
$$;
revoke all on function public.account_deletion_impact() from public, anon;
grant execute on function public.account_deletion_impact() to authenticated;

create or replace function public.delete_my_account_with_owned_content(p_confirmation text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or auth.role() <> 'authenticated' then
    raise exception 'Sign in to delete your account' using errcode = '28000';
  end if;
  if p_confirmation is distinct from 'DELETE SHARED DATA' then
    raise exception 'Explicit confirmation of shared-data deletion is required' using errcode = '22023';
  end if;

  -- Intentionally destructive only after explicit informed confirmation:
  -- owned networks also cascade their members, checklists and checklist
  -- content; externally linked conversations and assessments are detached.
  delete from public.networks where created_by = uid;
  delete from public.mawl_checklists where created_by = uid;
  -- Other collaborators' checklists remain; rows last updated by this
  -- person cannot retain their user ID (nonnullable FK without SET NULL).
  delete from public.mawl_progress where updated_by = uid;

  -- Reuse the existing carefully scoped, transactional deletion procedure.
  perform public.delete_my_account();
end;
$$;
revoke all on function public.delete_my_account_with_owned_content(text) from public, anon;
grant execute on function public.delete_my_account_with_owned_content(text) to authenticated;
