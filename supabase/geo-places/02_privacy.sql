-- ============================================================================
-- Worldwide places — location privacy, enforced in the database
--
-- Every insert/update on conversation_events and church_assessments has its
-- coordinates rounded before they are stored:
--   2 decimals (~1 km)                     normally
--   1 decimal  (~11 km), city-only names   in restricted countries, or when
--                                          the country is unknown (fail safe)
-- /geo.js applies the same rules in the browser; this trigger is the backstop
-- for cached old app versions and anything else that writes directly.
-- Keep the country list in sync with RESTRICTED in /geo.js.
--
-- ONE-WAY: rounding discards precision. Any existing row touched by an update
-- (including scripts/backfill-places.mjs) is rounded and cannot be restored.
-- That is the point — precise points that are never stored can never leak.
--
-- Run after 01_schema.sql. Idempotent, safe to re-run.
-- ============================================================================

create or replace function public.geo_is_restricted(cc text)
returns boolean
language sql
immutable
as $$
  -- Open Doors World Watch List top 50 plus other high-risk countries. Review yearly.
  select upper(coalesce(cc, '')) = any (array[
    'KP','SO','YE','LY','SD','ER','NG','PK','IR','AF','IN','SA','MM',
    'ML','CN','MV','IQ','SY','DZ','BF','MA','LA','MR','UZ','BD','OM',
    'CF','CU','NE','TM','CO','EG','CD','VN','MX','MZ','CM','TJ','BN',
    'QA','KZ','ET','TN','TR','BT','KG','NI','JO','PS','KM','MY','KW',
    'AZ','TD','AE','BH','DJ'
  ])
$$;

create or replace function public.geo_coarsen()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  coarse boolean := new.country_code is null or public.geo_is_restricted(new.country_code);
begin
  if new.latitude is not null and new.longitude is not null then
    new.latitude  := round(new.latitude::numeric,  case when coarse then 1 else 2 end);
    new.longitude := round(new.longitude::numeric, case when coarse then 1 else 2 end);
  end if;
  -- No neighbourhood names where they could identify someone.
  if public.geo_is_restricted(new.country_code) and new.city is not null then
    new.location_text := new.city;
  end if;
  return new;
end
$$;

drop trigger if exists conversation_events_geo_coarsen on public.conversation_events;
create trigger conversation_events_geo_coarsen
  before insert or update on public.conversation_events
  for each row execute function public.geo_coarsen();

drop trigger if exists church_assessments_geo_coarsen on public.church_assessments;
create trigger church_assessments_geo_coarsen
  before insert or update on public.church_assessments
  for each row execute function public.geo_coarsen();
