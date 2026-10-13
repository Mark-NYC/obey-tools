-- ============================================================================
-- Worldwide places - PART 2 of 2 (run after 06_private_reads.sql)
--
-- Public totals for /progress, server-side geocoding with a cache, grants,
-- and finally the lock: raw conversation rows readable only by their owner
-- (and network members, unchanged). Idempotent, safe to re-run.
-- ============================================================================

create extension if not exists http with schema extensions;

-- Public /progress page (no sign-in): country totals only. Restricted
-- countries are never named - they roll up into "+ N more countries".
create or replace function public.public_progress()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with ev as (
    select country_code, place_key, coalesce(count, 1) as n, event_type,
           created_at >= now() - interval '30 days' as recent
    from public.conversation_events
    where network_id is null and country_code is not null
  ),
  by_country as (
    select country_code,
           sum(n) as total, sum(n) filter (where recent) as last30,
           count(distinct place_key) as places
    from ev group by country_code
  )
  select jsonb_build_object(
    'total',        coalesce((select sum(n) from ev), 0),
    'last30',       coalesce((select sum(n) from ev where recent), 0),
    'discovery',    coalesce((select sum(n) from ev where event_type = 'discovery'), 0),
    'places',       (select count(distinct place_key) from ev),
    'countries',    (select count(*) from by_country),
    'listed',       coalesce((select jsonb_agg(jsonb_build_object(
                        'cc', country_code, 'total', total, 'last30', coalesce(last30, 0), 'places', places)
                        order by total desc)
                      from by_country where not public.geo_is_restricted(country_code)), '[]'::jsonb),
    'more_countries', (select count(*) from by_country where public.geo_is_restricted(country_code)),
    'more_total',     coalesce((select sum(total) from by_country where public.geo_is_restricted(country_code)), 0)
  )
$$;

-- Server-side reverse geocoding with a ~100 m cache: the geocoder sees only
-- Supabase, never a user's phone. Mirrors placeFromAddress() in /geo.js.
create table if not exists public.geo_cache (
  lat3 numeric, lon3 numeric, address jsonb, fetched_at timestamptz default now(),
  primary key (lat3, lon3)
);
alter table public.geo_cache enable row level security;   -- no client access

create or replace function public.geo_place_from_address(a jsonb)
returns jsonb language plpgsql immutable set search_path = public
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
  if a is null or (cc is null and city is null) then return null; end if;
  if public.geo_is_restricted(cc) then hood := null; end if;
  return jsonb_build_object(
    'country_code', cc, 'region', region, 'city', city,
    'location_text', coalesce(nullif(concat_ws(', ', hood, city), ''), region),
    'place_key', case when city is not null then concat_ws('|', coalesce(cc, ''), coalesce(region, ''), city) end,
    'place_label', case when city is not null then concat_ws(', ', city, abbrev, cc) end);
end
$$;

create or replace function public.geo_reverse(lat double precision, lon double precision)
returns jsonb
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare
  la numeric := round(lat::numeric, 3);
  lo numeric := round(lon::numeric, 3);
  addr jsonb;
  resp extensions.http_response;
begin
  if auth.uid() is null or lat is null or lon is null then return null; end if;
  select address into addr from public.geo_cache where lat3 = la and lon3 = lo;
  if not found then
    begin
      resp := extensions.http((
        'GET',
        'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=en'
          || '&lat=' || la || '&lon=' || lo,
        array[extensions.http_header('User-Agent', 'obey.tools (https://obey.tools)')],
        null, null)::extensions.http_request);
    exception when others then
      return null;
    end;
    if resp.status <> 200 then return null; end if;
    addr := resp.content::jsonb -> 'address';
    insert into public.geo_cache (lat3, lon3, address) values (la, lo, addr) on conflict do nothing;
  end if;
  return public.geo_place_from_address(addr);
end
$$;

-- -- Grants ------------------------------------------------------------------
revoke all on function public.map_events()                      from public, anon;
revoke all on function public.map_laborers()                    from public, anon;
revoke all on function public.map_recent(timestamptz, int)      from public, anon;
revoke all on function public.progress_metrics(int)             from public, anon;
revoke all on function public.place_counts(text, text)          from public, anon;
revoke all on function public.geo_reverse(double precision, double precision) from public, anon;
revoke all on function public.geo_place_from_address(jsonb)     from public, anon, authenticated;
grant execute on function public.map_events()                   to authenticated;
grant execute on function public.map_laborers()                 to authenticated;
grant execute on function public.map_recent(timestamptz, int)   to authenticated;
grant execute on function public.progress_metrics(int)          to authenticated;
grant execute on function public.place_counts(text, text)       to authenticated;
grant execute on function public.geo_reverse(double precision, double precision) to authenticated;
grant execute on function public.public_progress()              to anon, authenticated;

-- -- Lock raw rows: your own, plus your networks' (unchanged for networks) ----
alter policy "members can read conversation events"
  on public.conversation_events
  to authenticated
  using (auth.uid() = user_id or (network_id is not null and public.is_network_member(network_id)));
