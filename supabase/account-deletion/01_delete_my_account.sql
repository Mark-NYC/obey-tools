-- DRAFT — NOT APPLIED. Review against the live schema before running.
--
-- In-app account deletion, required by App Store Review Guideline 5.1.1(v)
-- for any app that lets people create an account. Called from the iOS app's
-- Settings screen:  supabase.rpc('delete_my_account')
--
-- Safety properties:
--   • Deletes ONLY the caller's own data (auth.uid()); takes no arguments.
--   • Runs in one transaction: if any delete fails (e.g. a foreign key from a
--     table not listed here), NOTHING is deleted and the app shows an error.
--   • Shared objects a user CREATED (networks, checklists) are NOT deleted, so
--     collaborators keep their data. See README.md — decide before applying.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tbl text;
  -- Personal, per-user tables keyed by user_id (from the site's queries).
  personal_tables text[] := array[
    'command_progress',
    'conversation_people',
    'conversation_events',
    'church_assessments',
    'submitted_events',
    'submitted_green_lights',
    'mawl_progress',
    'checklist_item_progress',
    'checklist_collaborators',
    'network_members'
  ];
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  foreach tbl in array personal_tables loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = tbl and column_name = 'user_id'
    ) then
      execute format('delete from public.%I where user_id = $1', tbl) using uid;
    end if;
  end loop;

  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
