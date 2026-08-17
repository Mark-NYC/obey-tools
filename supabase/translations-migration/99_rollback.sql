-- ============================================================================
-- STEP 99 — Full rollback of the translation admin schema (Phase 0).
--
-- Drops everything 01/02/03 created and removes the profiles column. Safe to
-- run at any point: the live site never depended on these objects (it keeps
-- using static /lang/*.json until Phase 3/4). Idempotent.
-- ============================================================================

begin;

drop view if exists public.public_releases;
drop view if exists public.public_languages;

drop function if exists public.save_translation(bigint,text,text);
drop function if exists public.submit_for_review(bigint,text);
drop function if exists public.review_decision(bigint,text,boolean);
drop function if exists public.assign_translator(uuid,text);
drop function if exists public.revoke_translator(uuid,text);
drop function if exists public.add_language(text,text,text,text);
drop function if exists public.publish_language(text);
drop function if exists public.restore_release(bigint);
drop function if exists public.can_translate(text);
drop function if exists public.is_translation_admin();

drop table if exists public.translation_releases       cascade;
drop table if exists public.translation_values         cascade;
drop table if exists public.translator_language_access cascade;
drop table if exists public.translation_keys           cascade;
drop table if exists public.languages                  cascade;

alter table public.profiles drop column if exists is_translation_admin;

commit;
