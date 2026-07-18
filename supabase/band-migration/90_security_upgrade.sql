-- ============================================================================
-- STEP 90 — Security upgrade (⚠ DO NOT RUN until the approach is approved)
--
-- Replaces the interim public policies with leader-gated access using the
-- site's EXISTING auth system: profiles.role = 'leader', the same gate
-- auth.js initLeaderPage() already uses on other leader pages. No new login
-- flow is created; leaders sign in once per device with the account they
-- already have.
--
-- Effect: reading and writing band data requires being signed in as a
-- profile with role 'leader'. The anon key alone can no longer read or
-- modify anything.
--
-- To instead keep the dashboard PUBLICLY VIEWABLE but leader-only WRITABLE,
-- use the alternative SELECT policies marked [PUBLIC-READ] below.
-- ============================================================================

-- Helper: is the caller a leader? SECURITY DEFINER so it can read profiles
-- regardless of the profiles table's own RLS.
create or replace function public.band_is_leader()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'leader'
  );
$$;

revoke all on function public.band_is_leader() from public;
grant execute on function public.band_is_leader() to authenticated, anon;

-- Remove interim public access.
drop policy if exists band_cities_interim_public  on public.band_cities;
drop policy if exists band_leaders_interim_public on public.band_leaders;
drop policy if exists band_posts_interim_public   on public.band_posts;

-- Idempotency: drop any earlier version of the leader policies first.
do $$
declare
  t text; p text;
begin
  foreach t in array array['band_cities','band_leaders','band_posts'] loop
    foreach p in array array['select','write','update','delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_leader_' || p, t);
    end loop;
  end loop;
end $$;

-- Leader-gated policies (reads and writes).
create policy band_cities_leader_select  on public.band_cities  for select to authenticated using (band_is_leader());
create policy band_cities_leader_write   on public.band_cities  for insert to authenticated with check (band_is_leader());
create policy band_cities_leader_update  on public.band_cities  for update to authenticated using (band_is_leader()) with check (band_is_leader());
create policy band_cities_leader_delete  on public.band_cities  for delete to authenticated using (band_is_leader());

create policy band_leaders_leader_select on public.band_leaders for select to authenticated using (band_is_leader());
create policy band_leaders_leader_write  on public.band_leaders for insert to authenticated with check (band_is_leader());
create policy band_leaders_leader_update on public.band_leaders for update to authenticated using (band_is_leader()) with check (band_is_leader());
create policy band_leaders_leader_delete on public.band_leaders for delete to authenticated using (band_is_leader());

create policy band_posts_leader_select   on public.band_posts   for select to authenticated using (band_is_leader());
create policy band_posts_leader_write    on public.band_posts   for insert to authenticated with check (band_is_leader());
create policy band_posts_leader_update   on public.band_posts   for update to authenticated using (band_is_leader()) with check (band_is_leader());
create policy band_posts_leader_delete   on public.band_posts   for delete to authenticated using (band_is_leader());

-- [PUBLIC-READ] alternative: to keep the dashboard viewable without sign-in,
-- run these three instead of relying solely on the leader SELECT policies:
-- create policy band_cities_public_read  on public.band_cities  for select to anon using (true);
-- create policy band_leaders_public_read on public.band_leaders for select to anon using (true);
-- create policy band_posts_public_read   on public.band_posts   for select to anon using (true);
-- NOTE: realtime events follow the same rules — anonymous viewers only
-- receive live updates if these public-read policies exist.

-- Belt and braces: drop anon's direct table privileges (RLS already blocks it
-- unless the [PUBLIC-READ] variant is used — skip these three lines in that case).
revoke all on public.band_cities  from anon;
revoke all on public.band_leaders from anon;
revoke all on public.band_posts   from anon;

-- The RPCs are SECURITY INVOKER, so these UPDATE policies govern them too.

-- After cutover, freeze the legacy blob so nothing can write to it anymore
-- (the backup table plus band_data remain readable in the SQL editor):
-- alter table public.band_data enable row level security;
-- (no policies = no API access; dashboard/SQL editor access is unaffected)
