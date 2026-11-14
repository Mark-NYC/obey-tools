-- DRAFT — NOT APPLIED. Review against the live schema before running.
-- Reviewed against the schema in this repo on 2026-11-14 (see README.md).
--
-- In-app account deletion, required by App Store Review Guideline 5.1.1(v)
-- for any app that lets people create an account. Called from the iOS app's
-- Settings screen:  supabase.rpc('delete_my_account')
--
-- What it does NOT touch: data saved on the person's device. The app keeps
-- that (offline-first promise) and detaches it from the deleted account.
--
-- Safety properties:
--   • Deletes ONLY the caller's own rows (auth.uid()); takes no arguments.
--   • One transaction: if any statement fails (e.g. a foreign key from a table
--     not handled here), NOTHING is deleted and the app reports the error.
--   • Shared objects a person CREATED (networks, checklists) are not deleted,
--     so collaborators keep their data. See README for the decision needed.
--   • Tables/columns that don't exist are skipped (checked at run time), so the
--     function can't fail on a table that was renamed or never created.

-- ── 1. Read-only preview: what WOULD be deleted for the caller ────────────
-- Safe to apply on its own. Lets you test with a throwaway account first:
--   select * from public.account_deletion_preview();
create or replace function public.account_deletion_preview()
returns table (table_name text, column_name text, row_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t record;
begin
  if uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  for t in
    select c.table_name::text as tn, c.column_name::text as cn
    from information_schema.columns c
    where c.table_schema = 'public'
      and (c.table_name, c.column_name) in (
        ('conversation_people', 'user_id'), ('submitted_events', 'user_id'),
        ('submitted_green_lights', 'user_id'), ('conversation_events', 'user_id'),
        ('command_progress', 'user_id'), ('church_assessments', 'user_id'),
        ('mawl_progress', 'user_id'), ('checklist_item_progress', 'user_id'),
        ('checklist_collaborators', 'user_id'), ('network_members', 'user_id'),
        ('leader_invites', 'invited_by'), ('networks', 'created_by'),
        ('mawl_checklists', 'created_by'), ('profiles', 'id'))
  loop
    table_name := t.tn; column_name := t.cn;
    execute format('select count(*) from public.%I where %I = $1', t.tn, t.cn) into row_count using uid;
    return next;
  end loop;
end;
$$;
revoke all on function public.account_deletion_preview() from public, anon;
grant execute on function public.account_deletion_preview() to authenticated;

-- ── 2. The deletion ──────────────────────────────────────────────────────
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t record;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  -- Personal rows keyed to the person. (Order matters only if these tables
  -- reference each other; none do in the client code.)
  for t in
    select c.table_name::text as tn, c.column_name::text as cn
    from information_schema.columns c
    where c.table_schema = 'public'
      and (c.table_name, c.column_name) in (
        ('conversation_people', 'user_id'),     -- Conversation Box people + notes
        ('submitted_events', 'user_id'),        -- which people reached a milestone
        ('submitted_green_lights', 'user_id'),
        ('conversation_events', 'user_id'),     -- map contributions (see README decision 3)
        ('command_progress', 'user_id'),        -- Commands / Stories progress
        ('church_assessments', 'user_id'),      -- Church Circle
        ('mawl_progress', 'user_id'),
        ('checklist_item_progress', 'user_id'),
        ('checklist_collaborators', 'user_id'),
        ('network_members', 'user_id'),
        ('leader_invites', 'invited_by'))       -- invites this person issued
  loop
    execute format('delete from public.%I where %I = $1', t.tn, t.cn) using uid;
  end loop;

  delete from public.profiles where id = uid;

  -- live_session_hosts / live_session_reports.facilitator_id are
  -- "on delete set null" (supabase/live-facilitation/01_schema.sql), so
  -- session history stays, anonymised. networks / mawl_checklists.created_by
  -- are NOT in this repo: if they reference auth.users without
  -- "on delete set null/cascade", the next line fails and everything rolls back.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
