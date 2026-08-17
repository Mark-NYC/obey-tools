-- ============================================================================
-- STEP 4 — Authorization proofs (Phase 0 gate). Run in the Supabase SQL editor
-- AFTER 01_schema, 02_authz, 03_languages, and the seeds.
--
-- Proves, before any editor exists:
--   * anon cannot read drafts (translation_values)
--   * a translator can read/edit ONLY assigned languages
--   * a translator cannot approve or publish
--   * an admin can approve and is gated into publish (Phase-2 stub)
--
-- Wrapped in a transaction that ROLLS BACK: it seeds two throwaway identities,
-- asserts, and leaves the database untouched. Replace the two UUIDs with real
-- auth.users ids (create one admin + one translator account via the app first),
-- OR keep the generated ones if your instance allows inserting into auth.users.
-- ============================================================================

begin;

-- Throwaway identities. If your instance forbids direct auth.users inserts,
-- delete these two inserts and set :admin_uid / :translator_uid to existing ids.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authz-admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'authz-translator@example.test')
on conflict (id) do nothing;

insert into public.profiles (id, role, is_translation_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 'user', true),
  ('00000000-0000-0000-0000-0000000000b2', 'user', false)
on conflict (id) do update set is_translation_admin = excluded.is_translation_admin;

-- Translator is assigned to 'es' ONLY.
insert into public.translator_language_access (user_id, language_code)
  values ('00000000-0000-0000-0000-0000000000b2', 'es') on conflict do nothing;

-- Helper to impersonate a signed-in user.
create or replace function pg_temp.act_as(p_uid text, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
end $$;

create or replace function pg_temp.act_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
end $$;

do $$
declare
  v_key   bigint;
  v_count int;
  v_err   text;
begin
  select id into v_key from public.translation_keys where key_path = 'auth.sign_up' limit 1;

  -- 1. anon cannot read drafts.
  perform pg_temp.act_anon();
  select count(*) into v_count from public.translation_values;
  assert v_count = 0, 'FAIL: anon read ' || v_count || ' draft rows';
  reset role;

  -- 2. anon CAN read published-current releases and active languages only.
  perform pg_temp.act_anon();
  perform 1 from public.public_languages;          -- must not error
  perform 1 from public.public_releases;           -- must not error
  reset role;

  -- 3. translator reads ONLY assigned language drafts.
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
  select count(distinct language_code) into v_count from public.translation_values;
  assert v_count <= 1, 'FAIL: translator saw ' || v_count || ' languages (expected only es)';
  perform set_config('role','authenticated',true);
  reset role;

  -- 4. translator can edit assigned language (es) ...
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
  perform public.save_translation(v_key, 'es', 'prueba');
  -- ... but NOT an unassigned language (de) -> forbidden.
  begin
    perform public.save_translation(v_key, 'de', 'versuch');
    raise exception 'FAIL: translator edited unassigned language de';
  exception when sqlstate '42501' then null; -- expected
  end;
  -- ... and cannot APPROVE (admin-only).
  begin
    perform public.review_decision(v_key, 'es', true);
    raise exception 'FAIL: translator approved a translation';
  exception when sqlstate '42501' then null; -- expected
  end;
  -- ... and cannot PUBLISH.
  begin
    perform public.publish_language('es');
    raise exception 'FAIL: translator published';
  exception when sqlstate '42501' then null; -- expected
  end;
  reset role;

  -- 5. admin CAN approve; publish is gated through (Phase-2 stub raises its own).
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
  perform public.review_decision(v_key, 'es', true);
  begin
    perform public.publish_language('es');
    raise exception 'FAIL: publish stub did not raise';
  exception
    when sqlstate '42501' then raise exception 'FAIL: admin was forbidden from publish';
    when others then
      get stacked diagnostics v_err = message_text;
      assert v_err = 'not_implemented_phase2', 'FAIL: unexpected publish error: ' || v_err;
  end;
  reset role;

  raise notice 'ALL AUTHORIZATION PROOFS PASSED';
end $$;

rollback;  -- leave the database exactly as it was
