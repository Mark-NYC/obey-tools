-- ============================================================================
-- STEP 5 — Phase 1 admin read/assignment layer. Additive, read-only + two
-- admin-gated assignment RPCs. NO publishing, NO public runtime reads, NO
-- schema changes to the Phase 0 tables. The live site is untouched.
--
-- Everything here respects the Phase 0 authorization model:
--   * the stats view is security_invoker, so translation_values RLS still
--     scopes a translator to their assigned languages;
--   * assignment RPCs are SECURITY DEFINER and admin-gated.
-- "Invalid" (placeholder/markup) is intentionally NOT computed here — it is
-- derived on the client with tools/i18n/catalog.mjs (the same Phase 0 logic),
-- so there is one source of truth for validation and no signature logic is
-- duplicated into SQL.
-- ============================================================================

begin;

-- Per-language dashboard stats. One row per language the caller may see.
-- Derived conditions only (workflow_status stays separate):
--   missing   = active translatable key with no non-empty value
--   outdated  = value present AND source hash drifted from the key
drop view if exists public.translation_language_stats;
create view public.translation_language_stats with (security_invoker = on) as
select
  l.code,
  l.english_name,
  l.native_name,
  l.direction,
  l.is_active,
  count(k.id)                                                              as total_keys,
  count(v.value) filter (where v.value is not null and btrim(v.value) <> '') as translated,
  count(*)       filter (where v.workflow_status = 'approved' and v.value is not null and btrim(v.value) <> '') as approved,
  count(*)       filter (where v.workflow_status = 'needs_review')         as needs_review,
  count(*)       filter (where v.workflow_status = 'draft' and v.value is not null and btrim(v.value) <> '') as draft,
  count(*)       filter (where v.value is not null and v.source_hash_at_translation is distinct from k.source_hash) as outdated,
  count(k.id) - count(v.value) filter (where v.value is not null and btrim(v.value) <> '') as missing,
  r.version                                                                as published_version,
  r.published_at
from public.languages l
cross join public.translation_keys k
left join public.translation_values v
       on v.key_id = k.id and v.language_code = l.code
left join public.translation_releases r
       on r.language_code = l.code and r.is_current
where k.is_active and k.is_translatable
  and public.can_translate(l.code)          -- admins: all; translators: assigned
group by l.code, l.english_name, l.native_name, l.direction, l.is_active, r.version, r.published_at;

grant select on public.translation_language_stats to authenticated;

-- Assign a translator by email (admins only). Email lookup is server-side and
-- gated, so it cannot be used for enumeration by non-admins.
create or replace function public.assign_translator_by_email(p_email text, p_lang text)
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if not public.is_translation_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then raise exception 'no_such_user'; end if;
  if not exists (select 1 from public.languages where code = p_lang) then raise exception 'no_such_language'; end if;
  insert into public.translator_language_access (user_id, language_code, assigned_by)
  values (v_uid, p_lang, auth.uid()) on conflict do nothing;
  return v_uid::text;
end $$;

-- List current translator assignments with emails (admins only), for the
-- assignment panel.
create or replace function public.list_translation_access()
returns table (user_id uuid, email text, language_code text, assigned_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_translation_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select a.user_id, u.email::text, a.language_code, a.assigned_at
    from public.translator_language_access a
    join auth.users u on u.id = a.user_id
    order by a.language_code, u.email;
end $$;

revoke all on function public.assign_translator_by_email(text,text) from public;
revoke all on function public.list_translation_access()            from public;
grant execute on function public.assign_translator_by_email(text,text) to authenticated;
grant execute on function public.list_translation_access()            to authenticated;

commit;
