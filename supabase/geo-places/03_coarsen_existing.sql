-- ============================================================================
-- Worldwide places — round every existing stored coordinate
--
-- Run LAST: after 02_privacy.sql and after scripts/backfill-places.mjs --apply,
-- so rows already know their country (unknown country → coarsest rounding).
-- The no-op assignment fires the geo_coarsen trigger on each row.
--
-- ONE-WAY: precise coordinates are gone afterwards. Idempotent.
-- ============================================================================

update public.conversation_events
   set latitude = latitude
 where latitude is not null;

update public.church_assessments
   set latitude = latitude
 where latitude is not null;
