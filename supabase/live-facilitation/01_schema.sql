-- ============================================================================
-- Live Group Facilitation — schema, RPCs, RLS, realtime  (TEST FEATURE)
--
-- Backs the unlinked test pages:
--   hope-for-the-rejected-live-test.html   (facilitator + participant view)
--   live-join-test.html                    (enter a 4-char code to join)
--
-- Design goals (mirrors the /band Option B migration's security posture):
--   * Anonymous participants can READ only the minimal, non-secret state
--     needed to follow an active session (id, story, current highlighted
--     part, status, times).  No secrets ever live in that readable row.
--   * The host (facilitator) token is NEVER stored in plaintext and NEVER
--     exposed to any client.  Only a SHA-256 hash is stored, in a separate
--     table with no client access at all.
--   * Every mutation (create / move highlight / end+report) goes through a
--     SECURITY DEFINER RPC that verifies the host token server-side.  Anon
--     and authenticated clients have NO direct INSERT/UPDATE/DELETE.
--   * Reports are private: only the authenticated facilitator who owns a
--     report may read it (supports a future leader dashboard).  Never public.
--
-- This file is idempotent and safe to re-run.  Apply it by pasting it into
-- the Supabase SQL editor (see README.md).  It is NOT run automatically.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Public-followable state. Contains NOTHING sensitive: the join_code is meant
-- to be shared, and the current part is exactly what participants must see.
create table if not exists public.live_sessions (
  id           uuid primary key default gen_random_uuid(),
  join_code    text not null,
  story_id     text not null,
  current_step integer not null default 1 check (current_step between 1 and 64),
  status       text not null default 'active' check (status in ('active','ended')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '6 hours',
  ended_at     timestamptz
);

-- Join codes are unique only among ACTIVE sessions. Ended/expired codes are
-- free to be reused by a later session.
create unique index if not exists live_sessions_active_code_uidx
  on public.live_sessions (join_code)
  where status = 'active';

create index if not exists live_sessions_status_idx
  on public.live_sessions (status);

-- Secret host material, kept out of the followable row. NO client policies are
-- created for this table, so RLS denies all API access; only the SECURITY
-- DEFINER RPCs below can read/write it.
create table if not exists public.live_session_hosts (
  session_id      uuid primary key references public.live_sessions(id) on delete cascade,
  host_token_hash text not null,
  facilitator_id  uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Reports. Private to their owning facilitator (when signed in). The story,
-- date, and session are recorded automatically. Structured to support a
-- future leader dashboard without change.
create table if not exists public.live_session_reports (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.live_sessions(id) on delete cascade,
  story_id        text not null,
  people_present  integer not null check (people_present  >= 0),
  people_set_goal integer not null check (people_set_goal >= 0),
  facilitator_id  uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint live_report_goal_le_present check (people_set_goal <= people_present)
);

create index if not exists live_reports_facilitator_idx
  on public.live_session_reports (facilitator_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Ambiguity-free 4-char code alphabet: uppercase letters + digits, minus the
-- confusable set O, 0, I, 1, L, 5.
create or replace function public.live_gen_code()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- Uppercase A–Z and digits 2–9, minus the confusable set O 0 I 1 L 5.
  clean constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ2346789';
  code  text;
  i        integer;
  tries    integer := 0;
begin
  loop
    code := '';
    for i in 1..4 loop
      code := code || substr(clean, 1 + floor(random() * length(clean))::int, 1);
    end loop;
    -- Unique among ACTIVE sessions only.
    if not exists (
      select 1 from live_sessions where join_code = code and status = 'active'
    ) then
      return code;
    end if;
    tries := tries + 1;
    if tries > 50 then
      raise exception 'live_gen_code: could not allocate a unique code';
    end if;
  end loop;
end $$;

-- Hash a host token the one and only way it is ever hashed. digest() is left
-- unqualified and resolved via search_path, so it works whether pgcrypto lives
-- in `extensions` (Supabase default) or `public`.
create or replace function public.live_hash_token(p_token text)
returns text
language sql
immutable
security definer
set search_path = public, extensions
as $$
  select encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- RPCs — all SECURITY DEFINER. These are the ONLY way to mutate state.
-- ---------------------------------------------------------------------------

-- Start a live session. Returns the new session id and its join code. The
-- caller supplies an unguessable host token (generated + stored client-side);
-- only its hash is persisted. facilitator_id is captured when signed in.
create or replace function public.live_create_session(
  p_story_id text,
  p_host_token text
)
returns table (session_id uuid, join_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
-- The OUT columns (session_id, join_code, expires_at) share names with
-- live_sessions columns; resolve any ambiguity in queries to the column.
#variable_conflict use_column
declare
  v_id   uuid;
  v_code text;
  v_exp  timestamptz;
begin
  if p_story_id is null or length(trim(p_story_id)) = 0 then
    raise exception 'live_create_session: story_id required';
  end if;
  if p_host_token is null or length(p_host_token) < 16 then
    raise exception 'live_create_session: a sufficiently long host token is required';
  end if;

  v_code := live_gen_code();

  insert into live_sessions (join_code, story_id)
  values (v_code, left(p_story_id, 128))
  returning id, live_sessions.expires_at into v_id, v_exp;

  insert into live_session_hosts (session_id, host_token_hash, facilitator_id)
  values (v_id, live_hash_token(p_host_token), auth.uid());

  session_id := v_id;
  join_code  := v_code;
  expires_at := v_exp;
  return next;
end $$;

-- Move the highlighted part. Verifies the host token, active status, and
-- non-expiry. Only changes the highlight — no per-item progress is recorded.
create or replace function public.live_set_step(
  p_session_id uuid,
  p_host_token text,
  p_step integer
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_new  integer;
begin
  select host_token_hash into v_hash
    from live_session_hosts where session_id = p_session_id;
  if v_hash is null or v_hash <> live_hash_token(p_host_token) then
    raise exception 'live_set_step: not authorized';
  end if;

  update live_sessions
     set current_step = greatest(1, least(64, p_step))
   where id = p_session_id
     and status = 'active'
     and expires_at > now()
   returning current_step into v_new;

  if v_new is null then
    raise exception 'live_set_step: session not active';
  end if;
  return v_new;
end $$;

-- End the session and save the report atomically. Validates the two numbers
-- (both >= 0; goals <= present). Associates the report with the authenticated
-- facilitator when one is signed in.
create or replace function public.live_end_session(
  p_session_id uuid,
  p_host_token text,
  p_people_present integer,
  p_people_set_goal integer
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash     text;
  v_story    text;
  v_fac      uuid;
begin
  select h.host_token_hash, s.story_id, h.facilitator_id
    into v_hash, v_story, v_fac
    from live_session_hosts h
    join live_sessions s on s.id = h.session_id
   where h.session_id = p_session_id;

  if v_hash is null or v_hash <> live_hash_token(p_host_token) then
    raise exception 'live_end_session: not authorized';
  end if;

  if p_people_present is null or p_people_present < 0
     or p_people_set_goal is null or p_people_set_goal < 0 then
    raise exception 'live_end_session: counts must be zero or greater';
  end if;
  if p_people_set_goal > p_people_present then
    raise exception 'live_end_session: goals cannot exceed people present';
  end if;

  insert into live_session_reports
    (session_id, story_id, people_present, people_set_goal, facilitator_id)
  values
    (p_session_id, v_story, p_people_present, p_people_set_goal,
     coalesce(auth.uid(), v_fac));

  update live_sessions
     set status = 'ended', ended_at = now(), expires_at = now()
   where id = p_session_id;
end $$;

-- Resolve a 4-char code to a followable active session. Uppercases the input
-- and refuses ended/expired sessions. Returns no secrets.
create or replace function public.live_get_by_code(p_code text)
returns table (
  session_id   uuid,
  story_id     text,
  current_step integer,
  status       text,
  expires_at   timestamptz
)
language sql
security definer
set search_path = public, extensions
as $$
  select id, story_id, current_step, status, expires_at
    from live_sessions
   where join_code = upper(trim(p_code))
     and status = 'active'
     and expires_at > now()
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.live_sessions        enable row level security;
alter table public.live_session_hosts   enable row level security;
alter table public.live_session_reports enable row level security;

-- live_sessions: readable by anyone (participants follow via this row and its
-- realtime stream). It holds no secrets. No direct writes — RPCs only.
drop policy if exists live_sessions_public_read on public.live_sessions;
create policy live_sessions_public_read
  on public.live_sessions for select to anon, authenticated using (true);

-- live_session_hosts: NO policies -> RLS denies all API access. Only the
-- SECURITY DEFINER RPCs (which bypass RLS) ever touch it.

-- live_session_reports: a signed-in facilitator may read only their own
-- reports. No anon access. Inserts happen only inside live_end_session.
drop policy if exists live_reports_owner_read on public.live_session_reports;
create policy live_reports_owner_read
  on public.live_session_reports for select to authenticated
  using (facilitator_id = auth.uid());

-- Belt and braces: strip any direct table DML privileges. RLS already blocks
-- writes (no write policies), and reads are governed by the policies above.
revoke insert, update, delete on public.live_sessions        from anon, authenticated;
revoke all                    on public.live_session_hosts   from anon, authenticated;
revoke insert, update, delete on public.live_session_reports from anon, authenticated;
revoke select                 on public.live_session_reports from anon;

-- The RPCs are the public surface. Grant execute; keep helpers internal.
grant execute on function public.live_create_session(text, text)              to anon, authenticated;
grant execute on function public.live_set_step(uuid, text, integer)           to anon, authenticated;
grant execute on function public.live_end_session(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.live_get_by_code(text)                       to anon, authenticated;
revoke all on function public.live_gen_code()        from public;
revoke all on function public.live_hash_token(text)  from public;

-- ---------------------------------------------------------------------------
-- Realtime: participants subscribe to their session's row and react to
-- current_step / status changes.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.live_sessions;
  exception when duplicate_object then null;
  end;
end $$;

-- Make PostgREST pick up the new/updated functions immediately (otherwise the
-- API can 404 the RPCs until its schema cache refreshes on its own).
notify pgrst, 'reload schema';
