-- FOLLOW DAILY shared Circle schedule. Additive migration; existing members and posts remain.
alter table public.follow_circles
 add column if not exists start_day integer not null default 1 check (start_day between 1 and 365),
 add column if not exists start_on date not null default current_date,
 add column if not exists time_zone text not null default 'UTC';

-- Existing Circles predate shared schedules. Begin their shared rhythm today,
-- at the owner's current personal reading where available. Never rewrite SOS.
update public.follow_circles c set
 start_day=coalesce((
  select least(365,greatest(1,max(s.value::integer)))
  from public.sos_daily_progress s
  where s.user_id=c.owner_id and s.field_name='cursor' and s.value ~ '^[0-9]{1,3}$'
 ),1),
 start_on=(now() at time zone 'UTC')::date,
 time_zone='UTC';

create table public.follow_circle_primary(
 user_id uuid primary key references auth.users(id) on delete cascade,
 circle_id uuid not null,
 chosen_at timestamptz not null default now(),
 foreign key(circle_id,user_id) references public.follow_circle_members(circle_id,user_id) on delete cascade
);
alter table public.follow_circle_primary enable row level security;
create policy follow_circle_primary_self on public.follow_circle_primary
 for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.follow_circle_primary from anon;
grant select on public.follow_circle_primary to authenticated;

-- First Circle automatically becomes primary. Later joins never replace it.
create function circles_private.assign_first_primary()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 insert into public.follow_circle_primary(user_id,circle_id)
 values(new.user_id,new.circle_id) on conflict(user_id) do nothing;
 return new;
end;$$;
revoke all on function circles_private.assign_first_primary() from public,anon,authenticated;
create trigger follow_circle_default_primary
 after insert on public.follow_circle_members
 for each row execute function circles_private.assign_first_primary();

-- Existing members keep their oldest membership as primary.
insert into public.follow_circle_primary(user_id,circle_id)
 select distinct on (user_id) user_id,circle_id
 from public.follow_circle_members
 order by user_id,joined_at,circle_id
on conflict(user_id) do nothing;

create function public.follow_circle_set_primary(p_circle uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not exists (
  select 1 from public.follow_circle_members
  where circle_id=p_circle and user_id=auth.uid()
 ) then raise exception 'Not a member of that Circle';end if;
 insert into public.follow_circle_primary(user_id,circle_id,chosen_at)
 values(auth.uid(),p_circle,now())
 on conflict(user_id) do update
 set circle_id=excluded.circle_id,chosen_at=excluded.chosen_at;
end;$$;
revoke all on function public.follow_circle_set_primary(uuid) from public,anon;
grant execute on function public.follow_circle_set_primary(uuid) to authenticated;

-- One small per-member RPC for schedule, Circle list and primary choice.
-- Server-side timezone arithmetic handles DST and travel correctly.
create function public.follow_circle_schedule()
returns table(circle_id uuid,circle_name text,day_no integer,finished boolean,
 is_primary boolean,time_zone text,start_day integer,start_on date)
language sql stable security definer set search_path=''
as $$
 select c.id,c.name,
  least(365,c.start_day+greatest(0,(now() at time zone c.time_zone)::date-c.start_on))::integer,
  c.start_day+greatest(0,(now() at time zone c.time_zone)::date-c.start_on)>365,
  (p.circle_id=c.id),c.time_zone,c.start_day,c.start_on
 from public.follow_circle_members m
 join public.follow_circles c on c.id=m.circle_id
 left join public.follow_circle_primary p on p.user_id=m.user_id
 where m.user_id=auth.uid() and c.closed_at is null
 order by (p.circle_id=c.id) desc,c.created_at,c.id
$$;
revoke all on function public.follow_circle_schedule() from public,anon;
grant execute on function public.follow_circle_schedule() to authenticated;

-- Creator chooses Day 1 or the current reading day, plus an IANA timezone.
-- Existing legacy create RPC remains available for older clients.
create function public.follow_circle_create_scheduled(
 p_name text,p_display_name text,p_start_day integer,p_time_zone text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_id uuid;v_user uuid:=auth.uid();v_token text;
begin
 if v_user is null then raise exception 'Sign in required';end if;
 if char_length(btrim(coalesce(p_name,''))) not between 2 and 80
 or char_length(btrim(coalesce(p_display_name,''))) not between 1 and 60
 then raise exception 'Invalid name';end if;
 if p_start_day is null or p_start_day not between 1 and 365
 then raise exception 'Invalid starting day';end if;
 if p_time_zone is null or not exists(
  select 1 from pg_catalog.pg_timezone_names where name=p_time_zone)
 then raise exception 'Invalid time zone';end if;
 insert into public.follow_circles(name,owner_id,start_day,start_on,time_zone)
 values(btrim(p_name),v_user,p_start_day,(now() at time zone p_time_zone)::date,p_time_zone)
 returning id into v_id;
 insert into public.follow_circle_members(circle_id,user_id,display_name,role)
 values(v_id,v_user,btrim(p_display_name),'steward');
 v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into public.follow_circle_invites(circle_id,token_hash,created_by)
 values(v_id,md5(v_token),v_user);
 return jsonb_build_object('circle_id',v_id,'token',v_token);
end;$$;
revoke all on function public.follow_circle_create_scheduled(text,text,integer,text) from public,anon;
grant execute on function public.follow_circle_create_scheduled(text,text,integer,text) to authenticated;
