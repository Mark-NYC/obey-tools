-- Follow Daily: yesterday's obedience check-in also needs private cross-device syncing.
alter table public.sos_daily_progress
 drop constraint if exists sos_daily_progress_field_name_check;
alter table public.sos_daily_progress
 add constraint sos_daily_progress_field_name_check
 check (field_name in ('read','say','obey','share','cursor','check'));
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
      or field not in ('read','say','obey','share','cursor','check') or text_value is null
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

