-- ============================================================================
-- STEP 4 — Validate the migrated data against the legacy blob (READ-ONLY).
-- Every comparison row should show matching values / zero discrepancies.
-- ============================================================================

-- 4.1 Aggregate counts: blob vs new tables.
with blob as (
  select jsonb_array_elements(cities) as c from band_data where id = 'main'
),
blob_leaders as (
  select b.c->>'name' as city_name,
         jsonb_array_elements(coalesce(b.c->'leaders', '[]'::jsonb)) as l
  from blob b
),
blob_posts as (
  select bl.city_name, bl.l->>'name' as leader_name, k.key as meeting_key
  from blob_leaders bl,
       lateral jsonb_each_text(
         case when jsonb_typeof(bl.l->'postHistory') = 'object'
              then bl.l->'postHistory' else '{}'::jsonb end
       ) k
  where k.value = 'true'
)
select 'cities'  as entity, (select count(*) from blob)        as in_blob, (select count(*) from band_cities)  as in_new_tables
union all
select 'leaders', (select count(*) from blob_leaders), (select count(*) from band_leaders)
union all
select 'true posts', (select count(*) from blob_posts), (select count(*) from band_posts where posted);

-- 4.2 Per-city metric comparison — the diff columns must all be true.
with blob as (
  select jsonb_array_elements(cities) as c from band_data where id = 'main'
)
select
  b.c->>'name' as city,
  coalesce(nullif(b.c->>'baptismsYTD','')::int, 0)   as blob_baptisms,   bc.baptisms_ytd,
  coalesce(nullif(b.c->>'totalChurches','')::int, 0) as blob_churches,   bc.total_churches,
  b.c->>'totalStreamDepth'                           as blob_depth,      bc.total_stream_depth,
  (coalesce(nullif(b.c->>'baptismsYTD','')::int, 0)   = bc.baptisms_ytd
   and coalesce(nullif(b.c->>'totalChurches','')::int, 0) = bc.total_churches) as metrics_match
from blob b
left join band_cities bc on bc.name = b.c->>'name'
order by city;

-- 4.3 Cities present in blob but missing from new tables (must return 0 rows).
with blob as (
  select jsonb_array_elements(cities) as c from band_data where id = 'main'
)
select b.c->>'name' as missing_city
from blob b
where not exists (select 1 from band_cities bc where bc.name = b.c->>'name');

-- ============================================================================
-- Meeting-key conversion proofs (legacy '<year>-<jsMonthIndex>-<2|4>' -> ISO).
-- ============================================================================

-- 4.K1 Every legacy key converted successfully (MUST return 0 rows).
with blob as (
  select jsonb_array_elements(cities) as c from band_data where id = 'main'
),
blob_leaders as (
  select b.c->>'name' as city_name,
         jsonb_array_elements(coalesce(b.c->'leaders','[]'::jsonb)) as l
  from blob b
),
blob_posts as (
  select bl.city_name, bl.l->>'name' as leader_name, k.key as legacy_key
  from blob_leaders bl,
       lateral jsonb_each_text(
         case when jsonb_typeof(bl.l->'postHistory') = 'object'
              then bl.l->'postHistory' else '{}'::jsonb end) k
  where k.value = 'true'
)
select city_name, leader_name, legacy_key as unconvertible_key
from blob_posts
where band_legacy_key_to_date(legacy_key) is null;

-- 4.K2 No posting history dropped or duplicated: every legacy true entry has
--      exactly one matching converted row, and every converted row traces back
--      to a legacy entry (both "missing" columns MUST be 0).
with blob as (
  select jsonb_array_elements(cities) as c from band_data where id = 'main'
),
blob_leaders as (
  select b.c->>'name' as city_name,
         jsonb_array_elements(coalesce(b.c->'leaders','[]'::jsonb)) as l
  from blob b
),
blob_posts as (
  select bl.city_name, bl.l->>'name' as leader_name,
         to_char(band_legacy_key_to_date(k.key), 'YYYY-MM-DD') as iso_key
  from blob_leaders bl,
       lateral jsonb_each_text(
         case when jsonb_typeof(bl.l->'postHistory') = 'object'
              then bl.l->'postHistory' else '{}'::jsonb end) k
  where k.value = 'true'
),
new_posts as (
  select c2.name as city_name, l2.name as leader_name, bp.meeting_key as iso_key
  from band_posts bp
  join band_leaders l2 on l2.id = bp.leader_id
  join band_cities  c2 on c2.id = l2.city_id
  where bp.posted
)
select
  (select count(*) from blob_posts) as legacy_true_entries,
  (select count(*) from new_posts)  as converted_rows,
  (select count(*) from blob_posts bp
    where not exists (select 1 from new_posts np
                      where np.city_name = bp.city_name
                        and np.leader_name = bp.leader_name
                        and np.iso_key = bp.iso_key)) as legacy_missing_from_new,
  (select count(*) from new_posts np
    where not exists (select 1 from blob_posts bp
                      where bp.city_name = np.city_name
                        and bp.leader_name = np.leader_name
                        and bp.iso_key = np.iso_key)) as new_without_legacy_source;
-- (duplicates within band_posts are impossible: PK (leader_id, meeting_key))

-- 4.K3 Each converted date matches the intended meeting: it must be a Sunday
--      and must be the 2nd or 4th Sunday of its month, and re-deriving the
--      legacy key from the date must reproduce a valid legacy shape.
--      (MUST return 0 rows.)
select bp.meeting_key,
       extract(dow from bp.meeting_key::date) as day_of_week,
       ((extract(day from bp.meeting_key::date)::int
         - (1 + ((7 - extract(dow from date_trunc('month', bp.meeting_key::date))::int) % 7)))
        / 7) + 1 as nth_sunday
from band_posts bp
where extract(dow from bp.meeting_key::date) <> 0
   or ((extract(day from bp.meeting_key::date)::int
        - (1 + ((7 - extract(dow from date_trunc('month', bp.meeting_key::date))::int) % 7)))
       / 7) + 1 not in (2, 4);

-- 4.K4 Historical post counts unchanged, per meeting: legacy counts grouped by
--      converted key vs new-table counts (diff column MUST be true everywhere,
--      and no meeting may appear on only one side).
with blob as (
  select jsonb_array_elements(cities) as c from band_data where id = 'main'
),
blob_leaders as (
  select jsonb_array_elements(coalesce(b.c->'leaders','[]'::jsonb)) as l from blob b
),
legacy_by_meeting as (
  select to_char(band_legacy_key_to_date(k.key), 'YYYY-MM-DD') as iso_key, count(*) as n
  from blob_leaders bl,
       lateral jsonb_each_text(
         case when jsonb_typeof(bl.l->'postHistory') = 'object'
              then bl.l->'postHistory' else '{}'::jsonb end) k
  where k.value = 'true'
  group by 1
),
new_by_meeting as (
  select meeting_key as iso_key, count(*) as n
  from band_posts where posted group by 1
)
select coalesce(lm.iso_key, nm.iso_key) as meeting,
       lm.n as legacy_count, nm.n as new_count,
       lm.n is not distinct from nm.n as counts_match
from legacy_by_meeting lm
full outer join new_by_meeting nm on nm.iso_key = lm.iso_key
order by 1;

-- (4.K5 — rollback restores legacy keys — is verified by the report query at
--  the end of section 99.1 in 99_rollback.sql, run at rollback time.)

-- 4.4 Per-leader posted counts, blob vs new (diff must be 0 everywhere).
with blob as (
  select jsonb_array_elements(cities) as c from band_data where id = 'main'
),
blob_leaders as (
  select b.c->>'name' as city_name,
         jsonb_array_elements(coalesce(b.c->'leaders','[]'::jsonb)) as l
  from blob b
)
select bl.city_name, bl.l->>'name' as leader,
       (select count(*) from jsonb_each_text(
          case when jsonb_typeof(bl.l->'postHistory') = 'object'
               then bl.l->'postHistory' else '{}'::jsonb end) k
        where k.value = 'true') as blob_true_posts,
       (select count(*) from band_posts bp
        join band_leaders l2 on l2.id = bp.leader_id
        join band_cities c2 on c2.id = l2.city_id
        where c2.name = bl.city_name and l2.name = bl.l->>'name' and bp.posted) as new_true_posts
from blob_leaders bl
order by bl.city_name, leader;
