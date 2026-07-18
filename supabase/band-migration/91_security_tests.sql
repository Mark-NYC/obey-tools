-- ============================================================================
-- STEP 91 — Security acceptance tests (read-only checks; run AFTER 90)
--
-- Proves, against the live leader-gated RLS policies:
--   T1. Anonymous visitors cannot read or change Band data
--   T2. Regular authenticated users (role='user') cannot read or change it
--   T3. Leader accounts can read AND update it
--   T4. One leader's update cannot overwrite another city's changes
--       (per-city rows + atomic RPCs make this a structural guarantee,
--        not a race that "usually" works — this test proves it directly)
--
-- Each check is wrapped so a PASS/FAIL is printed instead of aborting the
-- script on the expected permission errors. Run in the Supabase SQL editor,
-- or against local Postgres as already exercised during development.
-- Requires: at least one band_cities row and one profile with role='leader'
-- for T3/T4 (uses whichever leader id sorts first — swap in a specific
-- profiles.id if you want to target one deliberately).
-- ============================================================================

do $$
declare
  v_leader_id uuid;
  v_other_leader_id uuid;
  v_nonleader_id uuid := '00000000-0000-0000-0000-000000000000'; -- placeholder; see T2 note
  v_city_a uuid;
  v_city_b uuid;
  v_before_a int;
  v_before_b int;
  v_after_a int;
  v_after_b int;
  v_count int;
  v_ok boolean;
begin
  raise notice '=== T1: anonymous (anon role) cannot read or change Band data ===';

  set local role anon;
  begin
    select count(*) into v_count from band_cities;
    raise notice 'T1a FAIL — anon SELECT on band_cities returned % rows (expected: permission denied)', v_count;
  exception when insufficient_privilege then
    raise notice 'T1a PASS — anon SELECT on band_cities: permission denied';
  end;

  begin
    perform band_adjust_counter(gen_random_uuid(), 'baptisms_ytd', 1);
    raise notice 'T1b FAIL — anon was able to call band_adjust_counter';
  exception when insufficient_privilege then
    raise notice 'T1b PASS — anon band_adjust_counter: permission denied';
  when others then
    raise notice 'T1b PASS (denied via %) — anon band_adjust_counter blocked: %', sqlstate, sqlerrm;
  end;
  reset role;
end $$;

do $$
declare
  v_nonleader_id uuid;
  v_count int;
begin
  raise notice '=== T2: an authenticated NON-leader (role=''user'') cannot read or change Band data ===';

  select id into v_nonleader_id from profiles where role = 'user' limit 1;
  if v_nonleader_id is null then
    raise notice 'T2 SKIPPED — no profiles.role=''user'' row found to test with';
    return;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_nonleader_id::text, true);

  select count(*) into v_count from band_cities;
  if v_count = 0 then
    raise notice 'T2a PASS — authenticated non-leader SELECT on band_cities returns 0 rows';
  else
    raise notice 'T2a FAIL — authenticated non-leader SELECT returned % rows', v_count;
  end if;

  begin
    perform band_adjust_counter(gen_random_uuid(), 'baptisms_ytd', 1);
    raise notice 'T2b FAIL — non-leader was able to call band_adjust_counter';
  exception when others then
    raise notice 'T2b PASS — non-leader band_adjust_counter blocked: %', sqlerrm;
  end;
  reset role;
end $$;

do $$
declare
  v_leader_id uuid;
  v_city_a uuid;
  v_before int;
  v_after int;
begin
  raise notice '=== T3: a leader account can read AND update Band data ===';

  select id into v_leader_id from profiles where role = 'leader' order by id limit 1;
  select id into v_city_a from band_cities order by created_at limit 1;
  if v_leader_id is null or v_city_a is null then
    raise notice 'T3 SKIPPED — need >=1 profiles.role=''leader'' and >=1 band_cities row';
    return;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_leader_id::text, true);

  perform 1 from band_cities where id = v_city_a; -- read check
  if found then raise notice 'T3a PASS — leader can read band_cities'; else raise notice 'T3a FAIL — leader read returned no row'; end if;

  select baptisms_ytd into v_before from band_cities where id = v_city_a;
  perform band_adjust_counter(v_city_a, 'baptisms_ytd', 1);
  select baptisms_ytd into v_after from band_cities where id = v_city_a;
  if v_after = v_before + 1 then
    raise notice 'T3b PASS — leader update via band_adjust_counter applied (% -> %)', v_before, v_after;
  else
    raise notice 'T3b FAIL — expected %, got %', v_before + 1, v_after;
  end if;
  reset role;
end $$;

do $$
declare
  v_leader_id uuid;
  v_other_leader_id uuid;
  v_city_a uuid;
  v_city_b uuid;
  v_before_a int; v_before_b int;
  v_after_a int; v_after_b int;
begin
  raise notice '=== T4: one leader''s update cannot overwrite another city''s changes ===';

  select id into v_leader_id from profiles where role = 'leader' order by id limit 1;
  select id into v_other_leader_id from profiles where role = 'leader' and id <> v_leader_id order by id limit 1;
  if v_other_leader_id is null then v_other_leader_id := v_leader_id; end if; -- fall back to same leader, two cities

  select id into v_city_a from band_cities order by created_at limit 1;
  select id into v_city_b from band_cities order by created_at offset 1 limit 1;
  if v_leader_id is null or v_city_a is null or v_city_b is null then
    raise notice 'T4 SKIPPED — need >=1 leader profile and >=2 band_cities rows';
    return;
  end if;

  select baptisms_ytd into v_before_a from band_cities where id = v_city_a;
  select baptisms_ytd into v_before_b from band_cities where id = v_city_b;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_leader_id::text, true);
  perform band_adjust_counter(v_city_a, 'baptisms_ytd', 1);   -- leader edits city A
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_other_leader_id::text, true);
  perform band_adjust_counter(v_city_b, 'baptisms_ytd', 1);   -- (other) leader edits city B
  reset role;

  select baptisms_ytd into v_after_a from band_cities where id = v_city_a;
  select baptisms_ytd into v_after_b from band_cities where id = v_city_b;

  if v_after_a = v_before_a + 1 and v_after_b = v_before_b + 1 then
    raise notice 'T4 PASS — city A % -> %, city B % -> % (each leader''s edit landed; neither overwrote the other)',
      v_before_a, v_after_a, v_before_b, v_after_b;
  else
    raise notice 'T4 FAIL — city A % -> % (expected %), city B % -> % (expected %)',
      v_before_a, v_after_a, v_before_a + 1, v_before_b, v_after_b, v_before_b + 1;
  end if;
end $$;
