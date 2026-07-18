-- ============================================================================
-- STEP 3 — Copy data from the legacy band_data blob into the new tables.
--
-- Idempotent and re-runnable: it clears the new tables and refills them from
-- the blob's current contents. Run it once to test, then run it again at
-- cutover (immediately before deploying the new band.html) so the snapshot
-- includes any edits made through the old page in between.
--
-- band_data itself is never modified.
--
-- Meeting keys are converted from the legacy '<year>-<jsMonthIndex>-<2|4>'
-- format (month 0-indexed, e.g. '2026-6-4' = 4th Sunday of JULY 2026) to the
-- ISO date of the meeting Sunday ('2026-07-26'). The conversion uses the same
-- nth-Sunday arithmetic as the page's getNthSundayOfMonth(). An unconvertible
-- key aborts the migration with an error — history is never silently dropped.
-- ============================================================================

create or replace function public.band_legacy_key_to_date(p_key text)
returns date
language plpgsql immutable set search_path = public
as $$
declare
  parts text[];
  y int; m0 int; n int;
  first_dow int;
  first_sunday int;
begin
  -- Already-ISO keys (new records, or a re-run over converted data) pass through.
  if p_key ~ '^\d{4}-\d{2}-\d{2}$' then
    return p_key::date;
  end if;
  parts := string_to_array(p_key, '-');
  if array_length(parts, 1) is distinct from 3 then return null; end if;
  y  := parts[1]::int;
  m0 := parts[2]::int;  -- JavaScript getMonth(): 0-11
  n  := parts[3]::int;  -- 2nd or 4th Sunday
  if y < 2000 or y > 2100 or m0 < 0 or m0 > 11 or n not in (2, 4) then
    return null;
  end if;
  -- Same formula as the page: firstSunday = 1 + (7 - firstDay.getDay()) % 7
  -- (extract(dow): 0 = Sunday, matching JS getDay()).
  first_dow := extract(dow from make_date(y, m0 + 1, 1))::int;
  first_sunday := 1 + ((7 - first_dow) % 7);
  return make_date(y, m0 + 1, first_sunday + (n - 1) * 7);
exception when others then
  return null;
end $$;

create or replace function public.band_migrate_from_blob()
returns table (cities_migrated int, leaders_migrated int, posts_migrated int)
language plpgsql security invoker set search_path = public
as $$
declare
  c jsonb;
  l jsonb;
  k text;
  v_city uuid;
  v_leader uuid;
  n_c int := 0;
  n_l int := 0;
  n_p int := 0;
  levels constant text[] := array['1st Gen','2nd Gen','3rd Gen','4th Gen'];
  v_depth text;
  v_total_depth text;
  v_date date;
begin
  delete from band_posts;
  delete from band_leaders;
  delete from band_cities;

  for c in
    select jsonb_array_elements(cities) from band_data where id = 'main'
  loop
    -- Normalize stream depth values the legacy blob may hold loosely.
    v_depth := c->>'streamDepth';
    if v_depth is null or not (v_depth = any(levels)) then v_depth := '1st Gen'; end if;
    v_total_depth := c->>'totalStreamDepth';
    if v_total_depth is null or not (v_total_depth = any(levels)) then v_total_depth := v_depth; end if;

    insert into band_cities
      (name, baptisms_ytd, churches_ytd, total_churches, stream_depth, total_stream_depth, momentum_history)
    values (
      c->>'name',
      greatest(0, coalesce(nullif(c->>'baptismsYTD','')::int, 0)),
      greatest(0, coalesce(nullif(c->>'churchesYTD','')::int, 0)),
      greatest(0, coalesce(nullif(c->>'totalChurches','')::int, 0)),
      v_depth,
      v_total_depth,
      coalesce(c->'momentumHistory', '[]'::jsonb)
    )
    -- Duplicate city names in the blob collapse into one row (first wins for
    -- metrics; leaders from both are merged under it).
    on conflict (name) do update set updated_at = now()
    returning id into v_city;
    n_c := n_c + 1;

    for l in
      select jsonb_array_elements(coalesce(c->'leaders', '[]'::jsonb))
    loop
      v_leader := null;
      insert into band_leaders (city_id, name)
      values (v_city, l->>'name')
      on conflict (city_id, name) do nothing
      returning id into v_leader;
      if v_leader is null then
        continue;  -- duplicate leader name within the city
      end if;
      n_l := n_l + 1;

      -- postHistory is {"<meetingKey>": true|false}. A legacy bug sometimes
      -- stored an array (which drops string keys) — those are skipped, same
      -- as the legacy sanitizeLeaders() did. Only true entries carry meaning.
      if jsonb_typeof(l->'postHistory') = 'object' then
        for k in select jsonb_object_keys(l->'postHistory')
        loop
          if (l->'postHistory'->>k) = 'true' then
            v_date := band_legacy_key_to_date(k);
            if v_date is null then
              raise exception
                'band_migrate_from_blob: unconvertible meeting key % (leader %, city %)',
                k, l->>'name', c->>'name';
            end if;
            insert into band_posts (leader_id, city_id, meeting_key, posted)
            values (v_leader, v_city, to_char(v_date, 'YYYY-MM-DD'), true)
            on conflict (leader_id, meeting_key) do update set posted = true;
            n_p := n_p + 1;
          end if;
        end loop;
      end if;
    end loop;
  end loop;

  return query select n_c, n_l, n_p;
end $$;

-- Run it and show what was migrated:
select * from public.band_migrate_from_blob();
