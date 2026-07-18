-- ============================================================================
-- STEP 2 — New per-city schema for the /band dashboard (Option B)
--
-- Creates band_cities / band_leaders / band_posts plus atomic RPCs, enables
-- RLS with INTERIM policies that match today's access model (public), and
-- adds the tables to the realtime publication.
--
-- Does NOT touch band_data. Does NOT migrate data (that is 03). Fully
-- reversible via 99_rollback.sql. Access is tightened later by
-- 90_security_upgrade.sql once the security approach is approved.
-- ============================================================================

-- Refuse to run without a backup.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'band_data_backup_20260718'
  ) then
    raise exception 'No backup found — run 01_backup.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables. One row per city: an update to one city can never touch another.
-- ---------------------------------------------------------------------------
create table if not exists public.band_cities (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  baptisms_ytd       integer not null default 0 check (baptisms_ytd >= 0),
  churches_ytd       integer not null default 0 check (churches_ytd >= 0),
  total_churches     integer not null default 0 check (total_churches >= 0),
  stream_depth       text not null default '1st Gen'
                     check (stream_depth in ('1st Gen','2nd Gen','3rd Gen','4th Gen')),
  total_stream_depth text not null default '1st Gen'
                     check (total_stream_depth in ('1st Gen','2nd Gen','3rd Gen','4th Gen')),
  momentum_history   jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.band_leaders (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references public.band_cities(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (city_id, name)
);

-- Posting status by leader + city + meeting period. Un-marking writes
-- posted=false rather than deleting, so realtime subscribers always get a
-- full row and history of corrections is visible.
create table if not exists public.band_posts (
  leader_id   uuid not null references public.band_leaders(id) on delete cascade,
  city_id     uuid not null references public.band_cities(id) on delete cascade,
  meeting_key text not null,  -- legacy format preserved: '<year>-<jsMonthIndex>-<2|4>', e.g. '2026-6-4'
  posted      boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (leader_id, meeting_key)
);

create index if not exists band_leaders_city_idx on public.band_leaders (city_id);
create index if not exists band_posts_city_meeting_idx on public.band_posts (city_id, meeting_key);

-- ---------------------------------------------------------------------------
-- Atomic RPCs. All SECURITY INVOKER so RLS applies to the caller.
-- Concurrent calls are serialized by row-level locking inside UPDATE:
-- two simultaneous +1s yield +2, and a decrement can never be "resurrected".
-- ---------------------------------------------------------------------------
create or replace function public.band_adjust_counter(
  p_city_id uuid, p_field text, p_delta integer
) returns integer
language plpgsql security invoker set search_path = public
as $$
declare
  v_new integer;
begin
  if p_field = 'baptisms_ytd' then
    update band_cities
       set baptisms_ytd = greatest(0, baptisms_ytd + p_delta),
           updated_at = now()
     where id = p_city_id
     returning baptisms_ytd into v_new;
  elsif p_field = 'churches_ytd' then
    -- The UI shows a single "Churches" number; legacy behavior mirrors
    -- churches_ytd into total_churches on every change. Preserved here.
    update band_cities
       set churches_ytd  = greatest(0, churches_ytd + p_delta),
           total_churches = greatest(0, churches_ytd + p_delta),
           updated_at = now()
     where id = p_city_id
     returning churches_ytd into v_new;
  else
    raise exception 'band_adjust_counter: invalid field %', p_field;
  end if;

  if v_new is null then
    raise exception 'band_adjust_counter: city % not found', p_city_id;
  end if;
  return v_new;
end $$;

create or replace function public.band_step_stream_depth(
  p_city_id uuid, p_delta integer
) returns text
language plpgsql security invoker set search_path = public
as $$
declare
  levels constant text[] := array['1st Gen','2nd Gen','3rd Gen','4th Gen'];
  v_new text;
begin
  update band_cities
     set stream_depth       = levels[greatest(1, least(4, array_position(levels, stream_depth) + p_delta))],
         total_stream_depth = levels[greatest(1, least(4, array_position(levels, stream_depth) + p_delta))],
         updated_at = now()
   where id = p_city_id
   returning stream_depth into v_new;

  if v_new is null then
    raise exception 'band_step_stream_depth: city % not found', p_city_id;
  end if;
  return v_new;
end $$;

create or replace function public.band_set_post(
  p_leader_id uuid, p_meeting_key text, p_posted boolean
) returns void
language plpgsql security invoker set search_path = public
as $$
begin
  insert into band_posts (leader_id, city_id, meeting_key, posted)
  select l.id, l.city_id, p_meeting_key, p_posted
    from band_leaders l
   where l.id = p_leader_id
  on conflict (leader_id, meeting_key)
    do update set posted = excluded.posted, updated_at = now();

  if not found then
    raise exception 'band_set_post: leader % not found', p_leader_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: enabled from day one. INTERIM policies reproduce today's access model
-- (public read/write with the anon key) so behavior is unchanged until the
-- security upgrade (90_security_upgrade.sql) replaces them.
-- ---------------------------------------------------------------------------
alter table public.band_cities  enable row level security;
alter table public.band_leaders enable row level security;
alter table public.band_posts   enable row level security;

drop policy if exists band_cities_interim_public  on public.band_cities;
drop policy if exists band_leaders_interim_public on public.band_leaders;
drop policy if exists band_posts_interim_public   on public.band_posts;

create policy band_cities_interim_public  on public.band_cities  for all to anon, authenticated using (true) with check (true);
create policy band_leaders_interim_public on public.band_leaders for all to anon, authenticated using (true) with check (true);
create policy band_posts_interim_public   on public.band_posts   for all to anon, authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Realtime: the new page subscribes to changes on all three tables and
-- refetches on any event (dataset is tiny), so no replica-identity tuning
-- is needed.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.band_cities;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.band_leaders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.band_posts;
  exception when duplicate_object then null;
  end;
end $$;
