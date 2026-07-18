-- ============================================================================
-- STEP 99 — Rollback (reversible migration guarantee)
--
-- The legacy band_data row is never modified by this migration, so rolling
-- back is: redeploy the old band.html, optionally copy post-cutover edits
-- back into the blob, then drop the new objects.
-- ============================================================================

-- 99.1 (Only if edits were made through the NEW tables after cutover.)
--      Export the new tables back into the legacy blob shape so the old page
--      shows the latest data:
update public.band_data
set cities = coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',             bc.name,
        'baptismsYTD',      bc.baptisms_ytd,
        'churchesYTD',      bc.churches_ytd,
        'totalChurches',    bc.total_churches,
        'streamDepth',      bc.stream_depth,
        'totalStreamDepth', bc.total_stream_depth,
        'momentumHistory',  bc.momentum_history,
        'leaders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', bl.name,
            'postHistory', coalesce((
              select jsonb_object_agg(bp.meeting_key, bp.posted)
              from public.band_posts bp
              where bp.leader_id = bl.id and bp.posted
            ), '{}'::jsonb)
          ) order by bl.created_at)
          from public.band_leaders bl
          where bl.city_id = bc.id
        ), '[]'::jsonb)
      ) order by bc.created_at)
      from public.band_cities bc
    ), cities),
    -- works whether last_modified is text or timestamptz
    last_modified = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    modified_by = 'rollback-script'
where id = 'main';

-- 99.2 Remove the new tables from the realtime publication.
do $$
begin
  begin
    alter publication supabase_realtime drop table public.band_cities;
  exception when undefined_object or undefined_table then null;
  end;
  begin
    alter publication supabase_realtime drop table public.band_leaders;
  exception when undefined_object or undefined_table then null;
  end;
  begin
    alter publication supabase_realtime drop table public.band_posts;
  exception when undefined_object or undefined_table then null;
  end;
end $$;

-- 99.3 Drop the new tables, then the functions. Tables must go first: the
--      leader RLS policies (90) depend on band_is_leader(), and dropping a
--      table drops its policies with it.
drop table if exists public.band_posts;
drop table if exists public.band_leaders;
drop table if exists public.band_cities;

drop function if exists public.band_adjust_counter(uuid, text, integer);
drop function if exists public.band_step_stream_depth(uuid, integer);
drop function if exists public.band_set_post(uuid, text, boolean);
drop function if exists public.band_migrate_from_blob();
drop function if exists public.band_is_leader();

-- 99.4 (Disaster recovery only — if band_data itself was somehow damaged.)
--      Restore the blob from the step-1 snapshot:
-- update public.band_data d
-- set cities = b.cities, last_modified = b.last_modified, modified_by = b.modified_by
-- from public.band_data_backup_20260718 b
-- where d.id = b.id;

-- Keep band_data_backup_20260718 until the new system has been trusted for a
-- while; drop it manually when no longer needed.
