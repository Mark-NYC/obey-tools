-- Follow Daily cloud progress, scoped to a signed-in Obey.Tools user.
-- Each SOS field has its own revision, so a draft on another device isn't wiped
-- by an older full-day snapshot. Guests still use localStorage.
create table if not exists public.sos_daily_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_no integer not null check (day_no between 1 and 365),
  field_name text not null check (field_name in ('read','say','obey','share')),
  value text not null default '',
  revision_ms bigint not null check (revision_ms >= 0 and revision_ms <= 9999999999999),
  saved_at timestamptz not null default now(),
  primary key (user_id,day_no,field_name),
  constraint sos_progress_value_length check (octet_length(value) <= 20000),
  constraint sos_progress_read_true check (field_name <> 'read' or value = 'true')
);
create index if not exists sos_progress_user_day_idx on public.sos_daily_progress(user_id,day_no);
alter table public.sos_daily_progress enable row level security;
revoke all on public.sos_daily_progress from public,anon,authenticated;
grant select,insert,update on public.sos_daily_progress to authenticated;
grant all on public.sos_daily_progress to service_role;

drop policy if exists sos_progress_read_own on public.sos_daily_progress;
create policy sos_progress_read_own on public.sos_daily_progress for select to authenticated
 using ((select auth.uid())=user_id);
drop policy if exists sos_progress_insert_own on public.sos_daily_progress;
create policy sos_progress_insert_own on public.sos_daily_progress for insert to authenticated
 with check ((select auth.uid())=user_id);
drop policy if exists sos_progress_update_own on public.sos_daily_progress;
create policy sos_progress_update_own on public.sos_daily_progress for update to authenticated
 using ((select auth.uid())=user_id)
 with check ((select auth.uid())=user_id);

-- SECURITY INVOKER: RLS still applies; user_id derives only from auth.uid().
-- One atomic request handles many local fields with conflict-aware revisions.
create or replace function public.sos_merge_progress(p_changes jsonb)
returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  item jsonb;
  who uuid := auth.uid();
  n integer := 0;
  field text;
  text_value text;
  day integer;
  revision bigint;
  changed integer;
begin
  if who is null then raise exception 'Sign in required'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array'
    or jsonb_array_length(p_changes) > 100 then raise exception 'Invalid progress batch'; end if;
  for item in select * from jsonb_array_elements(p_changes)
  loop
    if jsonb_typeof(item) <> 'object' then raise exception 'Invalid progress item'; end if;
    if coalesce(item->>'day','') !~ '^[0-9]{1,3}$'
      or coalesce(item->>'revision','') !~ '^[0-9]{1,13}$'
      then raise exception 'Invalid day or revision'; end if;
    day := (item->>'day')::integer;
    revision := (item->>'revision')::bigint;
    field := item->>'field';
    text_value := item->>'value';
    if day < 1 or day > 365 or revision < 0 or revision > 9999999999999
      or field not in ('read','say','obey','share') or text_value is null
      or octet_length(text_value) > 20000
      or (field='read' and text_value <> 'true')
      then raise exception 'Invalid progress value'; end if;
    insert into public.sos_daily_progress as d
      (user_id,day_no,field_name,value,revision_ms,saved_at)
    values (who,day,field,text_value,revision,now())
    on conflict (user_id,day_no,field_name) do update
      set value=excluded.value,revision_ms=excluded.revision_ms,saved_at=now()
      where excluded.revision_ms > d.revision_ms;
    get diagnostics changed = row_count;
    n:=n+changed;
  end loop;
  return n;
end $$;
revoke all on function public.sos_merge_progress(jsonb) from public,anon,authenticated;
grant execute on function public.sos_merge_progress(jsonb) to authenticated;

comment on table public.sos_daily_progress is
 'Private per-user, per-day Say/Obey/Share drafts and read state. Email signup does not require account.';
