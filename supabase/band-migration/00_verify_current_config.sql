-- ============================================================================
-- STEP 0 — Verify current live configuration (READ-ONLY, safe to run anytime)
-- Run in the Supabase dashboard SQL editor and save the output.
-- This answers the open questions from the reliability assessment.
-- ============================================================================

-- 0.1 Which tables are in the realtime publication?
--     If band_data is absent, the legacy "Live Meeting Mode" never received
--     events even when enabled. The new tables must be added (02 does this).
select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;

-- 0.2 Exact band_data columns (the app writes modified_by on every save —
--     confirm it exists) and the type of last_modified.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'band_data'
order by ordinal_position;

-- 0.3 Is RLS enabled on band_data / profiles, and what policies exist?
select c.relname, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('band_data', 'profiles');

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('band_data', 'profiles')
order by tablename, policyname;

-- 0.4 What privileges do anon / authenticated hold on band_data?
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'band_data'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

-- 0.5 Current data summary (sanity check before backup).
select id,
       last_modified,
       modified_by,
       jsonb_array_length(cities) as city_count,
       (select count(*)
        from jsonb_array_elements(cities) c,
             jsonb_array_elements(coalesce(c->'leaders', '[]'::jsonb))) as leader_count
from band_data;

-- 0.6 How many leaders exist in profiles (candidates for band access)?
select role, count(*) from profiles group by role;
