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
