-- ============================================================================
-- Worldwide places - backfill old rows from inside Supabase (no terminal)
--
-- Same job as scripts/backfill-places.mjs, for when you only have the SQL
-- editor. Uses the `http` extension to reverse-geocode with Nominatim,
-- 1 lookup/second (Nominatim policy), one lookup per distinct coordinate
-- pair - after 03_coarsen_existing.sql many rows share a pair.
--
-- Step 1: paste this whole file -> Run (creates the functions).
-- Step 2: run, and repeat until remaining = 0 (~45 s per run):
--
--     select * from public.geo_backfill_batch(40);
--
-- Step 3 (optional): clean up - see the bottom of this file.
--
-- Place fields match /geo.js exactly (place_key 'US|Texas|Paris',
-- place_label 'Paris, TX, US', city-only text in restricted countries).
-- Idempotent, safe to re-run.
-- ============================================================================

create extension if not exists http with schema extensions;

-- Coordinate pairs Nominatim returned no city for - skipped on later runs.
create table if not exists public.geo_backfill_skipped (
  latitude  double precision,
  longitude double precision,
  primary key (latitude, longitude)
);
alter table public.geo_backfill_skipped enable row level security;   -- no client access

-- Nominatim `address` -> place fields. Mirrors placeFromAddress() in /geo.js.
create or replace function public.geo_place_from_address(a jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  cc     text := upper(nullif(a->>'country_code', ''));
  region text := coalesce(nullif(a->>'state', ''), nullif(a->>'province', ''),
                          nullif(a->>'region', ''), nullif(a->>'state_district', ''));
  rcode  text := split_part(coalesce(a->>'ISO3166-2-lvl4', a->>'ISO3166-2-lvl3', ''), '-', 2);
  city   text := coalesce(nullif(a->>'city', ''), nullif(a->>'town', ''), nullif(a->>'village', ''),
                          nullif(a->>'municipality', ''), nullif(a->>'hamlet', ''), nullif(a->>'county', ''));
  hood   text := coalesce(nullif(a->>'neighbourhood', ''), nullif(a->>'suburb', ''), nullif(a->>'quarter', ''));
  abbrev text := case when cc in ('US', 'CA', 'AU') and rcode ~ '^[A-Z]{1,3}$' then rcode end;
begin
  if city is null then return null; end if;
  if public.geo_is_restricted(cc) then hood := null; end if;
  return jsonb_build_object(
    'country_code',  cc,
    'region',        region,
    'city',          city,
    'location_text', concat_ws(', ', hood, city),
    'place_key',     concat_ws('|', coalesce(cc, ''), coalesce(region, ''), city),
    'place_label',   concat_ws(', ', city, abbrev, cc)
  );
end
$$;

create or replace function public.geo_backfill_batch(batch int default 40)
returns table (updated_pairs int, skipped_pairs int, http_errors int, remaining_pairs bigint, last_error text)
language plpgsql
set search_path = public, extensions
as $$
declare
  pt    record;
  resp  extensions.http_response;
  place jsonb;
  n_ok  int := 0;
  n_skip int := 0;
  n_err int := 0;
  err   text;
begin
  for pt in
    select distinct latitude, longitude from (
      select latitude, longitude from public.conversation_events
       where place_key is null and latitude is not null and longitude is not null
      union
      select latitude, longitude from public.church_assessments
       where place_key is null and latitude is not null and longitude is not null
    ) p
    where not exists (select 1 from public.geo_backfill_skipped s
                       where s.latitude = p.latitude and s.longitude = p.longitude)
    limit batch
  loop
    perform pg_sleep(1.1);
    begin
      resp := extensions.http((
        'GET',
        'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=en'
          || '&lat=' || pt.latitude || '&lon=' || pt.longitude,
        array[extensions.http_header('User-Agent', 'obey.tools place backfill (https://obey.tools)')],
        null, null
      )::extensions.http_request);
    exception when others then
      n_err := n_err + 1; err := sqlerrm;
      continue;
    end;

    if resp.status <> 200 then
      n_err := n_err + 1; err := 'HTTP ' || resp.status || ': ' || left(resp.content, 200);
      continue;
    end if;

    place := public.geo_place_from_address(resp.content::jsonb -> 'address');
    if place is null then
      insert into public.geo_backfill_skipped values (pt.latitude, pt.longitude) on conflict do nothing;
      n_skip := n_skip + 1;
      continue;
    end if;

    update public.conversation_events set
      country_code = place->>'country_code', region = place->>'region', city = place->>'city',
      location_text = place->>'location_text', place_key = place->>'place_key', place_label = place->>'place_label'
    where place_key is null and latitude = pt.latitude and longitude = pt.longitude;

    update public.church_assessments set
      country_code = place->>'country_code', region = place->>'region', city = place->>'city',
      location_text = place->>'location_text', place_key = place->>'place_key', place_label = place->>'place_label'
    where place_key is null and latitude = pt.latitude and longitude = pt.longitude;

    n_ok := n_ok + 1;
  end loop;

  return query
    select n_ok, n_skip, n_err, count(*), err from (
      select latitude, longitude from public.conversation_events
       where place_key is null and latitude is not null and longitude is not null
      union
      select latitude, longitude from public.church_assessments
       where place_key is null and latitude is not null and longitude is not null
    ) p
    where not exists (select 1 from public.geo_backfill_skipped s
                       where s.latitude = p.latitude and s.longitude = p.longitude);
end
$$;

-- Only you (SQL editor / service role) can run these.
revoke all on function public.geo_backfill_batch(int)      from public, anon, authenticated;
revoke all on function public.geo_place_from_address(jsonb) from public, anon, authenticated;

-- -- Clean up when remaining_pairs = 0 ---------------------------------------
-- drop function if exists public.geo_backfill_batch(int);
-- drop function if exists public.geo_place_from_address(jsonb);
-- drop table if exists public.geo_backfill_skipped;
