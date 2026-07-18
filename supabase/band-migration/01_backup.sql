-- ============================================================================
-- STEP 1 — Back up band_data (run BEFORE any schema change)
-- Creates a durable copy inside the database AND emits a JSON export to save
-- outside the database (copy the query result into a file and keep it).
-- ============================================================================

-- 1.1 In-database snapshot. The fixed name is intentional: 02_schema.sql
--     refuses to run unless this table exists.
create table if not exists public.band_data_backup_20260718 as
select b.*, now() as backed_up_at
from public.band_data b;

-- If you need to refresh the snapshot (e.g. re-running the migration later),
-- uncomment the next two lines instead of the CREATE above:
-- drop table if exists public.band_data_backup_20260718;
-- create table public.band_data_backup_20260718 as select b.*, now() as backed_up_at from public.band_data b;

-- 1.2 Verify the snapshot matches.
select 'live' as source, id, last_modified, jsonb_array_length(cities) as city_count from public.band_data
union all
select 'backup', id, last_modified, jsonb_array_length(cities) from public.band_data_backup_20260718;

-- 1.3 JSON export — run this, then save the full output to a local file
--     (e.g. band_data_backup_20260718.json) somewhere outside Supabase.
select jsonb_pretty(to_jsonb(b)) as band_data_export
from public.band_data b;
