-- Conversation Box × Circles, plus churches that link Circles.
-- Additive only: no existing rows, columns, policies or functions change meaning.
--
-- Privacy contract (tested in scripts/circles-conversations-tests.sql):
--  * No function here ever selects or returns a person's name from
--    conversation_people. Circles and churches see counts by stage only.
--  * A member's totals count only after they opt in (share_conversations).
--  * A step is shared only when the member explicitly sends it to a Circle.
--  * Prayer requests are Circle posts of kind 'prayer' whose subject must be
--    initials (for example "J. K."). A full name is rejected by the database.
--  * Church admins see per-Circle counts. They never read Circle posts,
--    members' progress, or anyone's names.

-- ── Stage helper ────────────────────────────────────────────────────────
create function circles_private.stage_no(p_stage text)
returns integer language sql immutable set search_path=''
as $$select array_position(array['casual','meaningful','spiritual','discovery'],p_stage)$$;
revoke all on function circles_private.stage_no(text) from public,anon;
grant execute on function circles_private.stage_no(text) to authenticated;

-- ── Opt in to include my Conversation Box totals in a Circle ────────────
alter table public.follow_circle_members
 add column if not exists share_conversations boolean not null default false;
grant update(share_conversations) on public.follow_circle_members to authenticated;

-- ── Prayer requests reuse Circle posts (reports, blocks, deletes, encouragements) ──
alter table public.follow_circle_posts
 add column if not exists kind text not null default 'post',
 add column if not exists prayer_initials text,
 add column if not exists prayer_stage text;
alter table public.follow_circle_posts
 add constraint follow_circle_posts_kind check(kind in ('post','prayer')),
 add constraint follow_circle_posts_prayer_shape check(
  (kind='post' and prayer_initials is null and prayer_stage is null)
  or (kind='prayer' and parent_id is null and reading_day is null
      and circles_private.stage_no(prayer_stage) is not null
      and char_length(body)<=280
      -- One to three initials, each one or two letters with an optional dot.
      and prayer_initials ~ '^[^[:space:][:digit:].]{1,2}\.?([[:space:]][^[:space:][:digit:].]{1,2}\.?){0,2}$'));
create index if not exists follow_circle_posts_prayer_idx
 on public.follow_circle_posts(circle_id,created_at desc) where kind='prayer';

-- ── Shared steps: stage movement only, never who ────────────────────────
create table public.follow_circle_steps(
 id uuid primary key default gen_random_uuid(),
 circle_id uuid not null references public.follow_circles(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 from_stage text,
 to_stage text not null,
 response text,
 created_at timestamptz not null default now(),
 constraint follow_circle_steps_to check(circles_private.stage_no(to_stage) is not null),
 -- Only new people (from_stage null) and forward moves are shared.
 constraint follow_circle_steps_forward check(from_stage is null
  or (circles_private.stage_no(from_stage) is not null
      and circles_private.stage_no(to_stage)>circles_private.stage_no(from_stage))),
 constraint follow_circle_steps_response check(response is null
  or (to_stage='discovery' and response in ('open','trusted','existing')))
);
create index follow_circle_steps_recent_idx on public.follow_circle_steps(circle_id,created_at desc);
create index follow_circle_steps_user_idx on public.follow_circle_steps(user_id,created_at desc);
alter table public.follow_circle_steps enable row level security;
create policy steps_add on public.follow_circle_steps for insert to authenticated
 with check(user_id=(select auth.uid()) and circles_private.is_member(circle_id,(select auth.uid())));
revoke all on public.follow_circle_steps from anon,authenticated;
grant insert(circle_id,user_id,from_stage,to_stage,response) on public.follow_circle_steps to authenticated;

create function circles_private.limit_steps() returns trigger language plpgsql
security definer set search_path=''
as $$
begin
 new.created_at:=now();
 if (select count(*) from public.follow_circle_steps where user_id=new.user_id and created_at>now()-interval '1 hour')>=60
 then raise exception 'Too many shared steps; try again later';end if;
 return new;
end;$$;
revoke all on function circles_private.limit_steps() from public,anon,authenticated;
create trigger follow_circle_limit_steps before insert on public.follow_circle_steps
 for each row execute function circles_private.limit_steps();

-- ── Weekly huddle goals: a number, never names ──────────────────────────
create table public.follow_circle_commitments(
 circle_id uuid not null references public.follow_circles(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 week_start date not null,
 goal integer not null check(goal between 0 and 50),
 updated_at timestamptz not null default now(),
 primary key(circle_id,user_id,week_start),
 check(extract(isodow from week_start)=1)
);
alter table public.follow_circle_commitments enable row level security;
create policy commitments_own on public.follow_circle_commitments for select to authenticated
 using(user_id=(select auth.uid()));
revoke all on public.follow_circle_commitments from anon,authenticated;
grant select on public.follow_circle_commitments to authenticated;

create function public.follow_circle_commit(p_circle uuid,p_week date,p_goal integer)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not circles_private.is_member(p_circle,auth.uid()) then raise exception 'Not permitted';end if;
 if p_week is null or extract(isodow from p_week)<>1 or p_week<current_date-13 or p_week>current_date+7
 then raise exception 'Choose this week';end if;
 if p_goal is null or p_goal not between 0 and 50 then raise exception 'Choose between 0 and 50';end if;
 insert into public.follow_circle_commitments(circle_id,user_id,week_start,goal,updated_at)
 values(p_circle,auth.uid(),p_week,p_goal,now())
 on conflict(circle_id,user_id,week_start) do update set goal=excluded.goal,updated_at=now();
end;$$;

-- ── What a Circle sees ──────────────────────────────────────────────────
-- Totals come from members who opted in. Week figures count shared steps
-- from current members in the last 7 days. Counts only.
create function public.follow_circle_cb_summary(p_circle uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v jsonb;
begin
 if not circles_private.is_member(p_circle,auth.uid()) then raise exception 'Not permitted';end if;
 select jsonb_build_object(
  'members',(select count(*) from public.follow_circle_members m where m.circle_id=p_circle),
  'sharing_members',(select count(*) from public.follow_circle_members m where m.circle_id=p_circle and m.share_conversations),
  'totals',(select jsonb_build_object(
    'casual',count(*) filter(where p.box_name='casual'),
    'meaningful',count(*) filter(where p.box_name='meaningful'),
    'spiritual',count(*) filter(where p.box_name='spiritual'),
    'discovery',count(*) filter(where p.box_name='discovery'))
   from public.conversation_people p
   join public.follow_circle_members m on m.user_id=p.user_id and m.circle_id=p_circle and m.share_conversations),
  'week',(select jsonb_build_object(
    'casual',count(*) filter(where s.to_stage='casual'),
    'meaningful',count(*) filter(where s.to_stage='meaningful'),
    'spiritual',count(*) filter(where s.to_stage='spiritual'),
    'discovery',count(*) filter(where s.to_stage='discovery'),
    'trusted',count(*) filter(where s.response='trusted'))
   from public.follow_circle_steps s
   join public.follow_circle_members m on m.circle_id=s.circle_id and m.user_id=s.user_id
   where s.circle_id=p_circle and s.created_at>now()-interval '7 days'),
  'goals',(select coalesce(sum(c.goal),0) from public.follow_circle_commitments c
   join public.follow_circle_members m on m.circle_id=c.circle_id and m.user_id=c.user_id
   where c.circle_id=p_circle and c.week_start>current_date-7),
  'committed_members',(select count(distinct c.user_id) from public.follow_circle_commitments c
   join public.follow_circle_members m on m.circle_id=c.circle_id and m.user_id=c.user_id
   where c.circle_id=p_circle and c.week_start>current_date-7 and c.goal>0)
 ) into v;
 return v;
end;$$;

create function public.follow_circle_cb_activity(p_circle uuid,p_days integer default 14)
returns table(user_id uuid,display_name text,from_stage text,to_stage text,response text,created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not circles_private.is_member(p_circle,auth.uid()) then raise exception 'Not permitted';end if;
 return query
 select s.user_id,m.display_name,s.from_stage,s.to_stage,s.response,s.created_at
 from public.follow_circle_steps s
 join public.follow_circle_members m on m.circle_id=s.circle_id and m.user_id=s.user_id
 where s.circle_id=p_circle
  and s.created_at>now()-make_interval(days=>least(greatest(coalesce(p_days,14),1),60))
  and not exists(select 1 from public.follow_circle_blocks b where b.user_id=auth.uid() and b.blocked_user_id=s.user_id)
 order by s.created_at desc limit 200;
end;$$;

-- ── Churches: link several Circles, see counts across them ──────────────
create table public.follow_churches(
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(btrim(name)) between 2 and 80),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 closed_at timestamptz
);
create table public.follow_church_admins(
 church_id uuid not null references public.follow_churches(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 display_name text not null check(char_length(btrim(display_name)) between 1 and 60),
 added_at timestamptz not null default now(),
 primary key(church_id,user_id)
);
create table public.follow_church_invites(
 id uuid primary key default gen_random_uuid(),
 church_id uuid not null references public.follow_churches(id) on delete cascade,
 token_hash text not null unique,
 kind text not null check(kind in ('circle','admin')),
 created_by uuid not null references auth.users(id) on delete cascade,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.follow_circles
 add column if not exists church_id uuid references public.follow_churches(id) on delete set null;
create index if not exists follow_circles_church_idx on public.follow_circles(church_id) where church_id is not null;

create function circles_private.is_church_admin(p_church uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.follow_church_admins a
 join public.follow_churches c on c.id=a.church_id
 where a.church_id=p_church and a.user_id=p_user and p_user=auth.uid() and c.closed_at is null)$$;
revoke all on function circles_private.is_church_admin(uuid,uuid) from public,anon;
grant execute on function circles_private.is_church_admin(uuid,uuid) to authenticated;

alter table public.follow_churches enable row level security;
alter table public.follow_church_admins enable row level security;
alter table public.follow_church_invites enable row level security;
-- Admins, and members of a linked Circle, can read the church's name.
create policy churches_read on public.follow_churches for select to authenticated
 using(closed_at is null and (circles_private.is_church_admin(id,(select auth.uid()))
  or exists(select 1 from public.follow_circles c where c.church_id=follow_churches.id)));
create policy church_admins_read on public.follow_church_admins for select to authenticated
 using(circles_private.is_church_admin(church_id,(select auth.uid())));
revoke all on public.follow_churches,public.follow_church_admins,public.follow_church_invites from anon,authenticated;
grant select on public.follow_churches,public.follow_church_admins to authenticated;

create function circles_private.new_token() returns text language sql volatile set search_path=''
as $$select replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')$$;
revoke all on function circles_private.new_token() from public,anon,authenticated;

create function public.follow_church_create(p_name text,p_display_name text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception 'Sign in required';end if;
 if char_length(btrim(coalesce(p_name,''))) not between 2 and 80 or char_length(btrim(coalesce(p_display_name,''))) not between 1 and 60 then raise exception 'Invalid name';end if;
 if (select count(*) from public.follow_churches where created_by=v_user and created_at>now()-interval '1 day')>=5 then raise exception 'Too many churches today';end if;
 insert into public.follow_churches(name,created_by) values(btrim(p_name),v_user) returning id into v_id;
 insert into public.follow_church_admins(church_id,user_id,display_name) values(v_id,v_user,btrim(p_display_name));
 return v_id;
end;$$;

create function public.follow_church_new_invite(p_church uuid,p_kind text)
returns text language plpgsql security definer set search_path=''
as $$
declare v_token text;
begin
 if not circles_private.is_church_admin(p_church,auth.uid()) then raise exception 'Not permitted';end if;
 if p_kind not in ('circle','admin') then raise exception 'Invalid invitation';end if;
 if (select count(*) from public.follow_church_invites where created_by=auth.uid() and created_at>now()-interval '1 day')>=20 then raise exception 'Too many invitations today';end if;
 v_token:=circles_private.new_token();
 insert into public.follow_church_invites(church_id,token_hash,kind,created_by) values(p_church,md5(v_token),p_kind,auth.uid());
 return v_token;
end;$$;

create function public.follow_church_revoke_invites(p_church uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not circles_private.is_church_admin(p_church,auth.uid()) then raise exception 'Not permitted';end if;
 update public.follow_church_invites set revoked_at=now() where church_id=p_church and revoked_at is null;
end;$$;

-- Signed-in preview: the church name and what the link does. Nothing else.
create function public.follow_church_invite_preview(p_token text)
returns jsonb language sql stable security definer set search_path=''
as $$select jsonb_build_object('church_id',c.id,'church_name',c.name,'kind',i.kind)
 from public.follow_church_invites i join public.follow_churches c on c.id=i.church_id
 where auth.uid() is not null and length(p_token)=64 and i.token_hash=md5(p_token)
  and i.revoked_at is null and c.closed_at is null limit 1$$;

-- An admin link adds you as an admin. A Circle link lets a steward link
-- one of their Circles; only the steward can do that.
create function public.follow_church_accept(p_token text,p_circle uuid default null,p_display_name text default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_church uuid;v_kind text;v_current uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 select i.church_id,i.kind into v_church,v_kind from public.follow_church_invites i
  join public.follow_churches c on c.id=i.church_id
  where char_length(coalesce(p_token,''))=64 and i.token_hash=md5(p_token) and i.revoked_at is null and c.closed_at is null;
 if v_church is null then raise exception 'Invalid or expired invitation';end if;
 if v_kind='admin' then
  if char_length(btrim(coalesce(p_display_name,''))) not between 1 and 60 then raise exception 'Invalid name';end if;
  insert into public.follow_church_admins(church_id,user_id,display_name)
  values(v_church,auth.uid(),btrim(p_display_name)) on conflict(church_id,user_id) do nothing;
 else
  if p_circle is null or not circles_private.is_steward(p_circle,auth.uid()) then raise exception 'Only the Circle''s steward can link it';end if;
  select church_id into v_current from public.follow_circles where id=p_circle for update;
  if v_current is not null and v_current<>v_church then raise exception 'This Circle is linked to another church. Unlink it first';end if;
  update public.follow_circles set church_id=v_church where id=p_circle;
 end if;
 return v_church;
end;$$;

create function public.follow_church_unlink(p_circle uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_church uuid;
begin
 select church_id into v_church from public.follow_circles where id=p_circle;
 if v_church is null then return;end if;
 if not (circles_private.is_steward(p_circle,auth.uid()) or circles_private.is_church_admin(v_church,auth.uid()))
 then raise exception 'Not permitted';end if;
 update public.follow_circles set church_id=null where id=p_circle;
end;$$;

create function public.follow_church_leave(p_church uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not circles_private.is_church_admin(p_church,auth.uid()) then raise exception 'Not an admin';end if;
 delete from public.follow_church_admins where church_id=p_church and user_id=auth.uid();
 if not exists(select 1 from public.follow_church_admins where church_id=p_church) then
  update public.follow_churches set closed_at=now() where id=p_church;
  update public.follow_circles set church_id=null where church_id=p_church;
 end if;
end;$$;

create function public.follow_church_list()
returns table(church_id uuid,name text,circles integer)
language sql stable security definer set search_path=''
as $$select c.id,c.name,(select count(*)::integer from public.follow_circles f where f.church_id=c.id and f.closed_at is null)
 from public.follow_church_admins a join public.follow_churches c on c.id=a.church_id
 where a.user_id=auth.uid() and c.closed_at is null order by c.name$$;

-- Per-Circle counts for church admins. No names, posts or progress.
create function public.follow_church_overview(p_church uuid)
returns table(circle_id uuid,circle_name text,members integer,sharing_members integer,
 casual integer,meaningful integer,spiritual integer,discovery integer,
 steps_30d integer,discovery_30d integer,trusted_30d integer,goals_week integer,
 last_huddle timestamptz,last_step timestamptz)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not circles_private.is_church_admin(p_church,auth.uid()) then raise exception 'Not permitted';end if;
 return query
 select f.id,f.name,
  (select count(*)::integer from public.follow_circle_members m where m.circle_id=f.id),
  (select count(*)::integer from public.follow_circle_members m where m.circle_id=f.id and m.share_conversations),
  t.casual,t.meaningful,t.spiritual,t.discovery,
  w.steps,w.discovery,w.trusted,
  (select coalesce(sum(c.goal),0)::integer from public.follow_circle_commitments c
    join public.follow_circle_members m on m.circle_id=c.circle_id and m.user_id=c.user_id
    where c.circle_id=f.id and c.week_start>current_date-7),
  (select max(c.updated_at) from public.follow_circle_commitments c where c.circle_id=f.id),
  (select max(s.created_at) from public.follow_circle_steps s where s.circle_id=f.id)
 from public.follow_circles f
 cross join lateral (select
   count(*) filter(where p.box_name='casual')::integer as casual,
   count(*) filter(where p.box_name='meaningful')::integer as meaningful,
   count(*) filter(where p.box_name='spiritual')::integer as spiritual,
   count(*) filter(where p.box_name='discovery')::integer as discovery
  from public.conversation_people p
  join public.follow_circle_members m on m.user_id=p.user_id and m.circle_id=f.id and m.share_conversations) t
 cross join lateral (select count(*)::integer as steps,
   count(*) filter(where s.to_stage='discovery')::integer as discovery,
   count(*) filter(where s.response='trusted')::integer as trusted
  from public.follow_circle_steps s
  join public.follow_circle_members m on m.circle_id=s.circle_id and m.user_id=s.user_id
  where s.circle_id=f.id and s.created_at>now()-interval '30 days') w
 where f.church_id=p_church and f.closed_at is null
 order by f.name;
end;$$;

-- ── Function permissions: authenticated only, never anon ────────────────
revoke all on function
 public.follow_circle_commit(uuid,date,integer),
 public.follow_circle_cb_summary(uuid),
 public.follow_circle_cb_activity(uuid,integer),
 public.follow_church_create(text,text),
 public.follow_church_new_invite(uuid,text),
 public.follow_church_revoke_invites(uuid),
 public.follow_church_invite_preview(text),
 public.follow_church_accept(text,uuid,text),
 public.follow_church_unlink(uuid),
 public.follow_church_leave(uuid),
 public.follow_church_list(),
 public.follow_church_overview(uuid)
from public,anon;
grant execute on function
 public.follow_circle_commit(uuid,date,integer),
 public.follow_circle_cb_summary(uuid),
 public.follow_circle_cb_activity(uuid,integer),
 public.follow_church_create(text,text),
 public.follow_church_new_invite(uuid,text),
 public.follow_church_revoke_invites(uuid),
 public.follow_church_invite_preview(text),
 public.follow_church_accept(text,uuid,text),
 public.follow_church_unlink(uuid),
 public.follow_church_leave(uuid),
 public.follow_church_list(),
 public.follow_church_overview(uuid)
to authenticated;
