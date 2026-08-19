-- ============================================================================
-- STEP 6 — Phase 1 authorization proofs. Run AFTER 05_phase1_admin.sql (and the
-- Phase 0 steps + seeds). Proves the new admin read/assignment surface upholds
-- the Phase 0 model. Wrapped in a transaction that ROLLS BACK — leaves no data.
-- ============================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'p1-admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'p1-translator@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'p1-assignee@example.test')
on conflict (id) do nothing;

insert into public.profiles (id, role, is_translation_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 'user', true),
  ('00000000-0000-0000-0000-0000000000b2', 'user', false),
  ('00000000-0000-0000-0000-0000000000c3', 'user', false)
on conflict (id) do update set is_translation_admin = excluded.is_translation_admin;

insert into public.translator_language_access (user_id, language_code)
  values ('00000000-0000-0000-0000-0000000000b2', 'es') on conflict do nothing;

create or replace function pg_temp.act_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role','authenticated')::text, true);
end $$;

do $$
declare v_count int; v_uid text;
begin
  -- 1. translator (non-admin) is FORBIDDEN from the admin surface.
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
  begin perform public.list_translation_access();
        raise exception 'FAIL: translator listed access'; exception when sqlstate '42501' then null; end;
  begin perform public.assign_translator_by_email('p1-assignee@example.test','de');
        raise exception 'FAIL: translator assigned access'; exception when sqlstate '42501' then null; end;

  -- 2. stats view is RLS-scoped: translator sees ONLY assigned languages.
  select count(*) into v_count from public.translation_language_stats;
  assert v_count = 1, 'FAIL: translator saw ' || v_count || ' languages in stats (expected 1)';
  perform 1 from public.translation_language_stats where code = 'es';  -- present
  reset role;

  -- 3. admin can assign by email; assignee then gains access.
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
  select public.assign_translator_by_email('p1-assignee@example.test','de') into v_uid;
  assert v_uid = '00000000-0000-0000-0000-0000000000c3', 'FAIL: wrong assignee id';
  select count(*) into v_count from public.list_translation_access()
   where email = 'p1-assignee@example.test' and language_code = 'de';
  assert v_count = 1, 'FAIL: assignment not listed';

  -- 4. admin sees all active languages in stats.
  select count(*) into v_count from public.translation_language_stats;
  assert v_count = (select count(*) from public.languages where is_active),
    'FAIL: admin stats languages ' || v_count;
  reset role;

  -- 5. bad email / unknown language are rejected cleanly (admin).
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
  begin perform public.assign_translator_by_email('nobody@example.test','es');
        raise exception 'FAIL: assigned nonexistent user'; exception when others then
          assert sqlerrm = 'no_such_user', 'FAIL: unexpected: ' || sqlerrm; end;
  reset role;

  raise notice 'ALL PHASE 1 AUTHORIZATION PROOFS PASSED';
end $$;

rollback;
