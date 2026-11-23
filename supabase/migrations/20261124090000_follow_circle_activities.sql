-- One Circle system, different purposes.
-- Each Circle chooses its activities: FOLLOW DAILY (shared reading), Conversations
-- (Conversation Box steps, prayer, huddles), or both. Additive only:
--  * Existing Circles keep both activities (what they can do today).
--  * Nothing is deleted when an activity is turned off; it is hidden, and new
--    activity of that kind is refused until it is turned back on.
--  * Only FOLLOW DAILY Circles can set someone's daily reading.
--    - The first FOLLOW DAILY Circle you join becomes your daily reading unless
--      you chose your own pace. Joining another Circle never replaces it.
--    - Leaving (or being removed from) your daily-reading Circle, or that Circle
--      turning FOLLOW DAILY off, moves your daily reading to your next FOLLOW
--      DAILY Circle, if any. An explicit "own pace" choice is never overridden.

alter table public.follow_circles
 add column if not exists uses_reading boolean not null default true,
 add column if not exists uses_conversations boolean not null default true;
alter table public.follow_circles
 add constraint follow_circles_some_activity check (uses_reading or uses_conversations);

-- ── Daily reading eligibility ───────────────────────────────────────────
-- Give a person a daily-reading Circle only when they have none recorded.
-- A recorded "own pace" (circle_id null) is an explicit choice and is kept.
create function circles_private.ensure_primary(p_user uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if exists(select 1 from public.follow_circle_primary where user_id=p_user) then return;end if;
 if not exists(select 1 from auth.users where id=p_user) then return;end if; -- account being deleted
 insert into public.follow_circle_primary(user_id,circle_id)
 select p_user,m.circle_id from public.follow_circle_members m
 join public.follow_circles c on c.id=m.circle_id
 where m.user_id=p_user and c.uses_reading and c.closed_at is null
 order by m.joined_at,m.circle_id limit 1
 on conflict(user_id) do nothing;
end;$$;
revoke all on function circles_private.ensure_primary(uuid) from public,anon,authenticated;

-- Joining: only a FOLLOW DAILY Circle can become the first daily reading.
create or replace function circles_private.assign_first_primary()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if exists(select 1 from public.follow_circles where id=new.circle_id and uses_reading) then
  insert into public.follow_circle_primary(user_id,circle_id)
  values(new.user_id,new.circle_id) on conflict(user_id) do nothing;
 end if;
 return new;
end;$$;

-- Leaving or removal: fall back to the next FOLLOW DAILY Circle.
create function circles_private.primary_after_leave()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 delete from public.follow_circle_primary where user_id=old.user_id and circle_id=old.circle_id;
 perform circles_private.ensure_primary(old.user_id);
 return old;
end;$$;
revoke all on function circles_private.primary_after_leave() from public,anon,authenticated;
create trigger follow_circle_primary_after_leave
 after delete on public.follow_circle_members
 for each row execute function circles_private.primary_after_leave();

-- Setting a daily reading: FOLLOW DAILY Circles only.
create or replace function public.follow_circle_set_primary(p_circle uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not exists (
  select 1 from public.follow_circle_members m join public.follow_circles c on c.id=m.circle_id
  where m.circle_id=p_circle and m.user_id=auth.uid() and c.closed_at is null
 ) then raise exception 'Not a member of that Circle';end if;
 if not exists(select 1 from public.follow_circles where id=p_circle and uses_reading)
 then raise exception 'This Circle doesn''t use FOLLOW DAILY';end if;
 insert into public.follow_circle_primary(user_id,circle_id,chosen_at)
 values(auth.uid(),p_circle,now())
 on conflict(user_id) do update
 set circle_id=excluded.circle_id,chosen_at=excluded.chosen_at;
end;$$;

-- Reading schedules: only FOLLOW DAILY Circles have a shared day.
-- Same columns as before, so existing pages keep working.
create or replace function public.follow_circle_schedule()
returns table(circle_id uuid,circle_name text,day_no integer,finished boolean,
 is_primary boolean,time_zone text,start_day integer,start_on date)
language sql stable security definer set search_path=''
as $$
 select c.id,c.name,
  least(365,c.start_day+greatest(0,(now() at time zone c.time_zone)::date-c.start_on))::integer,
  c.start_day+greatest(0,(now() at time zone c.time_zone)::date-c.start_on)>365,
  coalesce(p.circle_id=c.id,false),c.time_zone,c.start_day,c.start_on
 from public.follow_circle_members m
 join public.follow_circles c on c.id=m.circle_id
 left join public.follow_circle_primary p on p.user_id=m.user_id
 where m.user_id=auth.uid() and c.closed_at is null and c.uses_reading
 order by (p.circle_id=c.id) desc,c.created_at,c.id
$$;

-- ── Creating with activities ────────────────────────────────────────────
create function public.follow_circle_create_with(
 p_name text,p_display_name text,p_reading boolean,p_conversations boolean,p_start_day integer,p_time_zone text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_id uuid;v_user uuid:=auth.uid();v_token text;v_zone text:=coalesce(p_time_zone,'UTC');v_start integer:=coalesce(p_start_day,1);
begin
 if v_user is null then raise exception 'Sign in required';end if;
 if char_length(btrim(coalesce(p_name,''))) not between 2 and 80
 or char_length(btrim(coalesce(p_display_name,''))) not between 1 and 60
 then raise exception 'Invalid name';end if;
 if not (coalesce(p_reading,false) or coalesce(p_conversations,false)) then raise exception 'Choose at least one thing to do together';end if;
 if v_start not between 1 and 365 then raise exception 'Invalid starting day';end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then raise exception 'Invalid time zone';end if;
 insert into public.follow_circles(name,owner_id,start_day,start_on,time_zone,uses_reading,uses_conversations)
 values(btrim(p_name),v_user,v_start,(now() at time zone v_zone)::date,v_zone,coalesce(p_reading,false),coalesce(p_conversations,false))
 returning id into v_id;
 insert into public.follow_circle_members(circle_id,user_id,display_name,role)
 values(v_id,v_user,btrim(p_display_name),'steward');
 v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into public.follow_circle_invites(circle_id,token_hash,created_by) values(v_id,md5(v_token),v_user);
 return jsonb_build_object('circle_id',v_id,'token',v_token);
end;$$;

-- ── Changing activities (steward only) ──────────────────────────────────
-- Turning FOLLOW DAILY off moves anyone reading with this Circle to their next
-- FOLLOW DAILY Circle. Turning it back on resumes the same calendar.
create function public.follow_circle_set_activities(p_circle uuid,p_reading boolean,p_conversations boolean)
returns void language plpgsql security definer set search_path=''
as $$
declare r record;
begin
 if not circles_private.is_steward(p_circle,auth.uid()) then raise exception 'Only the steward can change this';end if;
 if not (coalesce(p_reading,false) or coalesce(p_conversations,false)) then raise exception 'Choose at least one thing to do together';end if;
 update public.follow_circles set uses_reading=p_reading,uses_conversations=p_conversations where id=p_circle;
 if not p_reading then
  for r in delete from public.follow_circle_primary where circle_id=p_circle returning user_id loop
   perform circles_private.ensure_primary(r.user_id);
  end loop;
 else
  for r in select m.user_id from public.follow_circle_members m where m.circle_id=p_circle loop
   perform circles_private.ensure_primary(r.user_id);
  end loop;
 end if;
end;$$;

-- ── New activity only where the activity is on ──────────────────────────
-- Earlier reflections, steps, prayer requests and goals are kept either way.
create function circles_private.require_activity() returns trigger language plpgsql
security definer set search_path=''
as $$
declare v_reading boolean;v_conv boolean;
begin
 select uses_reading,uses_conversations into v_reading,v_conv from public.follow_circles where id=new.circle_id;
 if tg_table_name='follow_circle_posts' then
  if new.kind='prayer' and not v_conv then raise exception 'This Circle doesn''t use Conversations';end if;
  if new.reading_day is not null and not v_reading then raise exception 'This Circle doesn''t use FOLLOW DAILY';end if;
 elsif not v_conv then
  raise exception 'This Circle doesn''t use Conversations';
 end if;
 return new;
end;$$;
revoke all on function circles_private.require_activity() from public,anon,authenticated;
create trigger follow_circle_posts_activity before insert on public.follow_circle_posts
 for each row execute function circles_private.require_activity();
create trigger follow_circle_steps_activity before insert on public.follow_circle_steps
 for each row execute function circles_private.require_activity();
create trigger follow_circle_commitments_activity before insert or update on public.follow_circle_commitments
 for each row execute function circles_private.require_activity();

revoke all on function
 public.follow_circle_create_with(text,text,boolean,boolean,integer,text),
 public.follow_circle_set_activities(uuid,boolean,boolean)
from public,anon;
grant execute on function
 public.follow_circle_create_with(text,text,boolean,boolean,integer,text),
 public.follow_circle_set_activities(uuid,boolean,boolean)
to authenticated;
