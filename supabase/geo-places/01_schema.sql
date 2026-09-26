-- ============================================================================
-- Worldwide places — country-aware location columns
--
-- Adds a stable, country-aware place to every mapped row so cities with the
-- same name in different countries/states never merge on /view-progress:
--   country_code  'US'              ISO 3166-1 alpha-2
--   region        'Texas'           state / province (English)
--   place_key     'US|Texas|Paris'  grouping key (country|region|city)
--   place_label   'Paris, TX, US'   display name
--
-- Written by conversation-box.html via /geo.js. Existing rows are filled by
-- scripts/backfill-places.mjs (see README.md).
--
-- Additive only: new nullable columns + indexes. Idempotent, safe to re-run.
-- Existing RLS policies cover the new columns unchanged.
-- ============================================================================

alter table public.conversation_events
  add column if not exists country_code text,
  add column if not exists region       text,
  add column if not exists place_key    text,
  add column if not exists place_label  text;

create index if not exists conversation_events_place_key_idx
  on public.conversation_events (place_key);
create index if not exists conversation_events_country_code_idx
  on public.conversation_events (country_code);

-- church_assessments: the map already reads latitude/longitude/location_text/
-- city from here; add the same place fields so churches group the same way.
alter table public.church_assessments
  add column if not exists latitude      double precision,
  add column if not exists longitude     double precision,
  add column if not exists location_text text,
  add column if not exists city          text,
  add column if not exists country_code  text,
  add column if not exists region        text,
  add column if not exists place_key     text,
  add column if not exists place_label   text;

create index if not exists church_assessments_place_key_idx
  on public.church_assessments (place_key);
