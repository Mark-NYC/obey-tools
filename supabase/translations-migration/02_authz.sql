-- ============================================================================
-- STEP 2 — Authorization (Phase 0): helpers, RLS policies, public read views,
-- and SECURITY DEFINER write RPCs. Editing is authorized BEFORE any editor
-- exists (per the corrected phase order).
--
-- Model:
--   * Admin       = profiles.is_translation_admin (orthogonal to 'leader').
--   * Translator  = has a row in translator_language_access for that language.
--   * Public      = anon; may read active languages and current releases only.
--   * Drafts (translation_values) are NEVER readable by anon.
--   * All writes go through SECURITY DEFINER RPCs — no direct INSERT/UPDATE/
--     DELETE grant exists — so field-level and workflow-transition rules cannot
--     be bypassed.
-- ============================================================================

begin;

-- ── Helpers (SECURITY DEFINER so they can read profiles/access under RLS) ────
create or replace function public.is_translation_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_translation_admin);
$$;

create or replace function public.can_translate(p_lang text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_translation_admin()
      or exists (select 1 from translator_language_access
                 where user_id = auth.uid() and language_code = p_lang);
$$;

revoke all on function public.is_translation_admin()      from public;
revoke all on function public.can_translate(text)         from public;
grant execute on function public.is_translation_admin()   to authenticated;
grant execute on function public.can_translate(text)      to authenticated;

-- ── RLS policies ─────────────────────────────────────────────────────────────
-- languages: public sees active; admins see all.
drop policy if exists languages_read on public.languages;
create policy languages_read on public.languages for select
  to anon, authenticated
  using (is_active = true or public.is_translation_admin());
grant select on public.languages to anon, authenticated;

-- translation_keys: signed-in editors only (English source content; not secret,
-- but no reason to expose to anon).
drop policy if exists keys_read on public.translation_keys;
create policy keys_read on public.translation_keys for select
  to authenticated using (true);
grant select on public.translation_keys to authenticated;

-- translation_values: drafts. Readable ONLY by a translator of that language or
-- an admin. Anon has neither a grant nor a policy => fully denied.
drop policy if exists values_read on public.translation_values;
create policy values_read on public.translation_values for select
  to authenticated using (public.can_translate(language_code));
grant select on public.translation_values to authenticated;

-- translator_language_access: a translator sees their own assignments; admin all.
drop policy if exists tla_read on public.translator_language_access;
create policy tla_read on public.translator_language_access for select
  to authenticated using (user_id = auth.uid() or public.is_translation_admin());
grant select on public.translator_language_access to authenticated;

-- translation_releases: only the CURRENT published release is world-readable.
drop policy if exists releases_read on public.translation_releases;
create policy releases_read on public.translation_releases for select
  to anon, authenticated using (is_current = true);
grant select on public.translation_releases to anon, authenticated;

-- ── Public read views (the two public contracts) ────────────────────────────
-- security_invoker => the querying role's RLS applies, so drafts stay hidden.
drop view if exists public.public_languages;
create view public.public_languages with (security_invoker = on) as
  select l.code, l.english_name, l.native_name, l.direction, l.sort_order,
         r.version as current_version
  from public.languages l
  left join public.translation_releases r
    on r.language_code = l.code and r.is_current
  where l.is_active;
grant select on public.public_languages to anon, authenticated;

drop view if exists public.public_releases;
create view public.public_releases with (security_invoker = on) as
  select language_code, version, catalog, catalog_hash, published_at
  from public.translation_releases
  where is_current;
grant select on public.public_releases to anon, authenticated;

-- ── Write RPCs (SECURITY DEFINER; each enforces its own authorization) ───────
-- Translator edit: sets the value only, resets to draft, pins the source hash.
create or replace function public.save_translation(p_key_id bigint, p_lang text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  if not public.can_translate(p_lang) then raise exception 'forbidden' using errcode = '42501'; end if;
  select source_hash into v_hash from translation_keys where id = p_key_id;
  if v_hash is null then raise exception 'unknown key'; end if;
  insert into translation_values (key_id, language_code, value, workflow_status, source_hash_at_translation, translator_id, updated_at)
  values (p_key_id, p_lang, p_value, 'draft', v_hash, auth.uid(), now())
  on conflict (key_id, language_code) do update
    set value = excluded.value,
        workflow_status = 'draft',
        source_hash_at_translation = excluded.source_hash_at_translation,
        translator_id = auth.uid(),
        updated_at = now();
end $$;

create or replace function public.submit_for_review(p_key_id bigint, p_lang text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_translate(p_lang) then raise exception 'forbidden' using errcode = '42501'; end if;
  update translation_values set workflow_status = 'needs_review', updated_at = now()
   where key_id = p_key_id and language_code = p_lang and workflow_status = 'draft';
end $$;

-- Approval is ADMIN-ONLY in v1 (translators cannot approve).
create or replace function public.review_decision(p_key_id bigint, p_lang text, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_translation_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update translation_values
     set workflow_status = case when p_approve then 'approved' else 'draft' end,
         reviewer_id = auth.uid(), updated_at = now()
   where key_id = p_key_id and language_code = p_lang;
end $$;

create or replace function public.assign_translator(p_user uuid, p_lang text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_translation_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into translator_language_access (user_id, language_code, assigned_by)
  values (p_user, p_lang, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.revoke_translator(p_user uuid, p_lang text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_translation_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from translator_language_access where user_id = p_user and language_code = p_lang;
end $$;

create or replace function public.add_language(
  p_code text, p_english_name text, p_native_name text, p_direction text default 'ltr')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_translation_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into languages (code, english_name, native_name, direction, is_active)
  values (p_code, p_english_name, p_native_name, p_direction, false);
end $$;

-- publish_language / restore_release: authorization is in force NOW (so it can
-- be proven translators cannot publish). The COMPILATION body lands in Phase 2.
create or replace function public.publish_language(p_lang text)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if not public.is_translation_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  raise exception 'not_implemented_phase2';
end $$;

create or replace function public.restore_release(p_release_id bigint)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if not public.is_translation_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  raise exception 'not_implemented_phase2';
end $$;

-- Gates enforce authz; grant execute broadly to signed-in users, none to anon.
revoke all on function
  public.save_translation(bigint,text,text),
  public.submit_for_review(bigint,text),
  public.review_decision(bigint,text,boolean),
  public.assign_translator(uuid,text),
  public.revoke_translator(uuid,text),
  public.add_language(text,text,text,text),
  public.publish_language(text),
  public.restore_release(bigint)
  from public;
grant execute on function
  public.save_translation(bigint,text,text),
  public.submit_for_review(bigint,text),
  public.review_decision(bigint,text,boolean),
  public.assign_translator(uuid,text),
  public.revoke_translator(uuid,text),
  public.add_language(text,text,text,text),
  public.publish_language(text),
  public.restore_release(bigint)
  to authenticated;

commit;
