-- ============================================================================
-- Worldwide places - totals instead of raw rows, server-side geocoding
--
-- Before: every signed-in user could read every conversation event row,
-- including user_id + place + time: enough to follow one person's pattern of
-- life. After: the map, metrics, ticker and "first on the map" read totals
-- through the functions below (no user_id ever leaves the database), and raw
-- rows are readable only by their owner (and network members, unchanged).
--
-- Also: geo_reverse() geocodes on the server with a cache, so the geocoder
-- never sees a user's phone; public_progress() feeds the public /progress page.
--
-- PART 1 of 2: the signed-in functions. Then run 07_private_reads_part2.sql.
-- Idempotent, safe to re-run. Requires 01/02 from this folder.
-- ============================================================================

create extension if not exists http with schema extensions;

-- Rows a signed-in user may count: public (no network) + their networks.
-- Same scope the old read policy gave them.
create or replace function public.progress_visible(n_id anyelement)
returns boolean language sql stable
as $$ select n_id is null or public.is_network_member(n_id) $$;

-- Map: one row per place x event type x day. No user_id.
create or replace function public.map_events()
returns table (latitude double precision, longitude double precision, location_text text, city text,
               country_code text, region text, place_key text, place_label text,
               event_type text, created_at timestamptz, count bigint)
language sql stable security definer set search_path = public
as $$
  select e.latitude, e.longitude, e.location_text, e.city, e.country_code, e.region,
         e.place_key, e.place_label, e.event_type,
         date_trunc('day', e.created_at) as created_at, sum(coalesce(e.count, 1))::bigint
  from public.conversation_events e
  where auth.uid() is not null
    and e.latitude is not null and e.longitude is not null
    and public.progress_visible(e.network_id)
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
$$;

-- Laborers (3+ updates in 30 days), each counted once at their most frequent
-- place, so summing any set of places never double-counts a person.
create or replace function public.map_laborers()
returns table (latitude double precision, longitude double precision, country_code text,
               region text, place_key text, laborers bigint)
language sql stable security definer set search_path = public
as $$
  with recent as (
    select e.user_id, e.latitude, e.longitude, e.country_code, e.region, e.place_key
    from public.conversation_events e
    where auth.uid() is not null
      and e.created_at >= now() - interval '30 days'
      and public.progress_visible(e.network_id)
  ),
  active as (select user_id from recent group by user_id having count(*) >= 3),
  home as (
    select distinct on (r.user_id) r.user_id, r.latitude, r.longitude, r.country_code, r.region, r.place_key
    from recent r join active a using (user_id)
    where r.latitude is not null and r.longitude is not null
    group by r.user_id, r.latitude, r.longitude, r.country_code, r.region, r.place_key
    order by r.user_id, count(*) desc
  )
  select latitude, longitude, country_code, region, place_key, count(*)::bigint
  from home group by 1, 2, 3, 4, 5
$$;

-- Live feed: latest events, no user, no place in restricted countries.
create or replace function public.map_recent(since timestamptz, max_rows int default 20)
returns table (created_at timestamptz, place_label text, city text, country_code text,
               event_type text, count int)
language sql stable security definer set search_path = public
as $$
  select e.created_at,
         case when public.geo_is_restricted(e.country_code) then null else e.place_label end,
         case when public.geo_is_restricted(e.country_code) then null else e.city end,
         e.country_code, e.event_type, coalesce(e.count, 1)
  from public.conversation_events e
  where auth.uid() is not null
    and e.created_at > since
    and public.progress_visible(e.network_id)
  order by e.created_at desc
  limit least(greatest(max_rows, 1), 100)
$$;

-- Metrics tab: totals for the period, the prior period, and 12 weekly buckets.
create or replace function public.progress_metrics(days int)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  cur_from timestamptz := case when days > 0 then now() - make_interval(days => days) end;
  pri_from timestamptz := case when days > 0 then now() - make_interval(days => days * 2) end;
  cur jsonb; pri jsonb; weeks jsonb;
begin
  if auth.uid() is null then return null; end if;

  select jsonb_build_object(
    'sp',      coalesce(sum(coalesce(count, 1)) filter (where event_type <> 'discovery'), 0),
    'disc',    coalesce(sum(coalesce(count, 1)) filter (where event_type = 'discovery'), 0),
    'places',  count(distinct coalesce(place_key, city)),
    'fishers', count(distinct user_id))
  into cur
  from public.conversation_events
  where public.progress_visible(network_id) and (cur_from is null or created_at >= cur_from);

  select jsonb_build_object(
    'sp',      coalesce(sum(coalesce(count, 1)) filter (where event_type <> 'discovery'), 0),
    'disc',    coalesce(sum(coalesce(count, 1)) filter (where event_type = 'discovery'), 0),
    'places',  count(distinct coalesce(place_key, city)),
    'fishers', count(distinct user_id))
  into pri
  from public.conversation_events
  where pri_from is not null and public.progress_visible(network_id)
    and created_at >= pri_from and created_at < cur_from;

  -- weeks[0] = oldest of the last 12 weeks, weeks[11] = this week
  select jsonb_agg(coalesce(w.n, 0) order by g.i desc)
  into weeks
  from generate_series(0, 11) as g(i)
  left join (
    select floor(extract(epoch from now() - created_at) / 604800)::int as i,
           sum(coalesce(count, 1)) as n
    from public.conversation_events
    where public.progress_visible(network_id) and created_at >= now() - interval '84 days'
    group by 1
  ) w on w.i = g.i;

  return jsonb_build_object('cur', cur, 'pri', case when pri_from is null then null else pri end, 'weeks', weeks);
end
$$;

-- "You're the first on the map in ..." - counts only, across all visible rows.
create or replace function public.place_counts(cc text, key text)
returns table (country_events bigint, place_events bigint)
language sql stable security definer set search_path = public
as $$
  select count(*) filter (where e.country_code = cc),
         count(*) filter (where key is not null and e.place_key = key)
  from public.conversation_events e
  where auth.uid() is not null
    and public.progress_visible(e.network_id)
    and (e.country_code = cc or (key is not null and e.place_key = key))
$$;
