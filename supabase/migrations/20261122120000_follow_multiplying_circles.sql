-- Multiplying Circles v1. Draft migration; apply only after integration and RLS tests.
-- No changes to existing SOS journal or progress storage.
create schema if not exists circles_private;
revoke all on schema circles_private from public, anon;
grant usage on schema circles_private to authenticated;
create table public.follow_circles(
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(btrim(name)) between 2 and 80),
 owner_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 closed_at timestamptz
);
create table public.follow_circle_members(
 circle_id uuid not null references public.follow_circles(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 display_name text not null check(char_length(btrim(display_name)) between 1 and 60),
 role text not null default 'member' check(role in ('steward','member')),
 progress_visible boolean not null default true,
 email_replies boolean not null default false,
 email_mentions boolean not null default false,
 email_digest boolean not null default false,
 joined_at timestamptz not null default now(),
 primary key(circle_id,user_id)
);
create index follow_circle_members_user_idx on public.follow_circle_members(user_id,circle_id);
create table public.follow_circle_invites(
 id uuid primary key default gen_random_uuid(),
 circle_id uuid not null references public.follow_circles(id) on delete cascade,
 token_hash text not null unique,
 created_by uuid not null references auth.users(id) on delete cascade,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.follow_circle_posts(
 id uuid primary key default gen_random_uuid(),
 circle_id uuid not null references public.follow_circles(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade,
 reading_day integer check(reading_day between 1 and 365),
 body text not null check(char_length(btrim(body)) between 1 and 3000),
 mentioned_user_ids uuid[] not null default '{}'::uuid[] check(cardinality(mentioned_user_ids)<=10),
 parent_id uuid references public.follow_circle_posts(id) on delete cascade,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint post_no_self_reply check(parent_id is null or parent_id <> id)
);
create index follow_circle_posts_recent_idx on public.follow_circle_posts(circle_id,created_at desc);
create index follow_circle_posts_passage_idx on public.follow_circle_posts(circle_id,reading_day,created_at desc);
create table public.follow_circle_reactions(
 post_id uuid not null references public.follow_circle_posts(id) on delete cascade,
 circle_id uuid not null references public.follow_circles(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(post_id,user_id)
);
create table public.follow_circle_reports(
 id uuid primary key default gen_random_uuid(),
 circle_id uuid not null references public.follow_circles(id) on delete cascade,
 post_id uuid references public.follow_circle_posts(id) on delete set null,
 reporter_id uuid not null references auth.users(id) on delete cascade,
 reason text not null check(char_length(btrim(reason)) between 4 and 500),
 created_at timestamptz not null default now()
);
create table public.follow_circle_email_outbox(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 circle_id uuid not null references public.follow_circles(id) on delete cascade,
 post_id uuid not null references public.follow_circle_posts(id) on delete cascade,
 kind text not null check(kind in ('reply','mention')),
 status text not null default 'pending' check(status in ('pending','sending','sent')),
 attempts integer not null default 0,
 retry_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 last_error text,
 unique(user_id,post_id,kind)
);
create index follow_circle_email_pending_idx on public.follow_circle_email_outbox(status,retry_at);
create table public.follow_circle_digest_deliveries(
 user_id uuid not null references auth.users(id) on delete cascade,
 circle_id uuid not null references public.follow_circles(id) on delete cascade,
 week_start date not null,
 status text not null default 'pending' check(status in ('pending','sent')),
 sent_at timestamptz,
 primary key(user_id,circle_id,week_start)
);
create table public.follow_circle_blocks(
 user_id uuid not null references auth.users(id) on delete cascade,
 blocked_user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,blocked_user_id),
 check(user_id<>blocked_user_id)
);
-- The following helper is deliberately narrow, not part of the public API.
create function circles_private.is_member(p_circle uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.follow_circle_members m
 join public.follow_circles c on c.id=m.circle_id
 where m.circle_id=p_circle and m.user_id=p_user and p_user=auth.uid() and c.closed_at is null)$$;
create function circles_private.is_steward(p_circle uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.follow_circle_members m
 join public.follow_circles c on c.id=m.circle_id
 where m.circle_id=p_circle and m.user_id=p_user and p_user=auth.uid() and m.role='steward' and c.closed_at is null)$$;
revoke all on function circles_private.is_member(uuid,uuid) from public;
revoke all on function circles_private.is_steward(uuid,uuid) from public;
grant execute on function circles_private.is_member(uuid,uuid) to authenticated;
grant execute on function circles_private.is_steward(uuid,uuid) to authenticated;
alter table public.follow_circles enable row level security;
alter table public.follow_circle_members enable row level security;
alter table public.follow_circle_invites enable row level security;
alter table public.follow_circle_posts enable row level security;
alter table public.follow_circle_reactions enable row level security;
alter table public.follow_circle_reports enable row level security;
alter table public.follow_circle_blocks enable row level security;
alter table public.follow_circle_email_outbox enable row level security;
alter table public.follow_circle_digest_deliveries enable row level security;
create policy circles_read on public.follow_circles for select to authenticated
 using(circles_private.is_member(id,(select auth.uid())));
create policy members_read on public.follow_circle_members for select to authenticated
 using(circles_private.is_member(circle_id,(select auth.uid())));
create policy members_edit_self on public.follow_circle_members for update to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy posts_read on public.follow_circle_posts for select to authenticated
 using(circles_private.is_member(circle_id,(select auth.uid()))
 and not exists(select 1 from public.follow_circle_blocks b
  where b.user_id=(select auth.uid()) and b.blocked_user_id=author_id));
create policy posts_add on public.follow_circle_posts for insert to authenticated
 with check(author_id=(select auth.uid()) and circles_private.is_member(circle_id,(select auth.uid()))
 and (parent_id is null or exists(select 1 from public.follow_circle_posts p where p.id=parent_id and p.circle_id=follow_circle_posts.circle_id and p.parent_id is null)));
create policy posts_edit on public.follow_circle_posts for update to authenticated
 using(author_id=(select auth.uid()) and circles_private.is_member(circle_id,(select auth.uid())))
 with check(author_id=(select auth.uid()) and circles_private.is_member(circle_id,(select auth.uid())));
create policy posts_delete on public.follow_circle_posts for delete to authenticated
 using((author_id=(select auth.uid()) or circles_private.is_steward(circle_id,(select auth.uid()))) and circles_private.is_member(circle_id,(select auth.uid())));
create policy reactions_read on public.follow_circle_reactions for select to authenticated
 using(circles_private.is_member(circle_id,(select auth.uid())));
create policy reactions_add on public.follow_circle_reactions for insert to authenticated
 with check(user_id=(select auth.uid()) and circles_private.is_member(circle_id,(select auth.uid()))
 and exists(select 1 from public.follow_circle_posts p where p.id=post_id and p.circle_id=follow_circle_reactions.circle_id));
create policy reactions_delete on public.follow_circle_reactions for delete to authenticated
 using(user_id=(select auth.uid()));
create policy reports_add on public.follow_circle_reports for insert to authenticated
 with check(reporter_id=(select auth.uid()) and circles_private.is_member(circle_id,(select auth.uid()))
 and (post_id is null or exists(select 1 from public.follow_circle_posts p where p.id=post_id and p.circle_id=follow_circle_reports.circle_id)));
create policy reports_steward_read on public.follow_circle_reports for select to authenticated
 using(circles_private.is_steward(circle_id,(select auth.uid())));
create policy blocks_all on public.follow_circle_blocks for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
-- Never expose invitation token hashes in the Data API.
revoke all on public.follow_circle_invites,public.follow_circle_email_outbox,public.follow_circle_digest_deliveries from anon, authenticated;
revoke all on public.follow_circles,public.follow_circle_members,public.follow_circle_posts,public.follow_circle_reactions,public.follow_circle_reports,public.follow_circle_blocks from anon;
grant select on public.follow_circles,public.follow_circle_members,public.follow_circle_posts,public.follow_circle_reactions,public.follow_circle_reports to authenticated;
grant insert on public.follow_circle_posts,public.follow_circle_reactions,public.follow_circle_reports,public.follow_circle_blocks to authenticated;
grant delete on public.follow_circle_posts,public.follow_circle_reactions,public.follow_circle_blocks to authenticated;
grant update(body,updated_at) on public.follow_circle_posts to authenticated;
grant update(display_name,progress_visible,email_replies,email_mentions,email_digest) on public.follow_circle_members to authenticated;
grant select on public.follow_circle_blocks to authenticated;
-- Invitation and membership operations must be atomic and validate auth.uid().
create function public.follow_circle_create(p_name text,p_display_name text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_id uuid;v_user uuid:=auth.uid();v_token text;
begin
 if v_user is null then raise exception 'Sign in required';end if;
 if char_length(btrim(coalesce(p_name,''))) not between 2 and 80 or char_length(btrim(coalesce(p_display_name,''))) not between 1 and 60 then raise exception 'Invalid name';end if;
 insert into public.follow_circles(name,owner_id) values(btrim(p_name),v_user) returning id into v_id;
 insert into public.follow_circle_members(circle_id,user_id,display_name,role) values(v_id,v_user,btrim(p_display_name),'steward');
 v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into public.follow_circle_invites(circle_id,token_hash,created_by) values(v_id,md5(v_token),v_user);
 return jsonb_build_object('circle_id',v_id,'token',v_token);
end;$$;
create function public.follow_circle_join(p_token text,p_display_name text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid();v_id uuid;
begin
 if v_user is null then raise exception 'Sign in required';end if;
 if char_length(coalesce(p_token,''))<>64 or char_length(btrim(coalesce(p_display_name,''))) not between 1 and 60 then raise exception 'Invalid invitation';end if;
 select i.circle_id into v_id from public.follow_circle_invites i join public.follow_circles c on c.id=i.circle_id
 where i.token_hash=md5(p_token) and i.revoked_at is null and c.closed_at is null;
 if v_id is null then raise exception 'Invalid or expired invitation';end if;
 insert into public.follow_circle_members(circle_id,user_id,display_name)
 values(v_id,v_user,btrim(p_display_name)) on conflict(circle_id,user_id) do nothing;
 return v_id;
end;$$;
-- Public preview intentionally reveals only Circle name, not member identities or posts.
create function public.follow_circle_invite_preview(p_token text)
returns jsonb language sql stable security definer set search_path=''
as $$select jsonb_build_object('circle_name',c.name,'circle_id',c.id) from public.follow_circle_invites i join public.follow_circles c on c.id=i.circle_id
 where length(p_token)=64 and i.token_hash=md5(p_token) and i.revoked_at is null and c.closed_at is null limit 1$$;
create function public.follow_circle_new_invite(p_circle uuid)
returns text language plpgsql security definer set search_path=''
as $$
declare v_token text;
begin
 if auth.uid() is null or not circles_private.is_member(p_circle,auth.uid()) then raise exception 'Not permitted';end if;
 if (select count(*) from public.follow_circle_invites where created_by=auth.uid() and created_at>now()-interval '1 day')>=20 then raise exception 'Too many invitations today';end if;
 v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into public.follow_circle_invites(circle_id,token_hash,created_by) values(p_circle,md5(v_token),auth.uid());
 return v_token;
end;$$;
create function public.follow_circle_revoke_invites(p_circle uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not circles_private.is_steward(p_circle,auth.uid()) then raise exception 'Not permitted';end if;
 update public.follow_circle_invites set revoked_at=now() where circle_id=p_circle and revoked_at is null;
end;$$;
create function public.follow_circle_leave(p_circle uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_role text;v_count bigint;
begin
 select role into v_role from public.follow_circle_members where circle_id=p_circle and user_id=auth.uid() for update;
 if v_role is null then raise exception 'Not a member';end if;
 if v_role='steward' then
  select count(*) into v_count from public.follow_circle_members where circle_id=p_circle;
  if v_count>1 then raise exception 'Transfer stewardship before leaving';end if;
  update public.follow_circles set closed_at=now() where id=p_circle;
 end if;
 delete from public.follow_circle_members where circle_id=p_circle and user_id=auth.uid();
end;$$;
create function public.follow_circle_remove(p_circle uuid,p_user uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not circles_private.is_steward(p_circle,auth.uid()) then raise exception 'Not permitted';end if;
 if p_user=auth.uid() then raise exception 'Use Leave Circle';end if;
 delete from public.follow_circle_members where circle_id=p_circle and user_id=p_user and role<>'steward';
end;$$;
create function public.follow_circle_transfer(p_circle uuid,p_user uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not circles_private.is_steward(p_circle,auth.uid()) then raise exception 'Not permitted';end if;
 if not exists(select 1 from public.follow_circle_members where circle_id=p_circle and user_id=p_user) then raise exception 'Recipient must be a member';end if;
 update public.follow_circle_members set role='member' where circle_id=p_circle and user_id=auth.uid();
 update public.follow_circle_members set role='steward' where circle_id=p_circle and user_id=p_user;
 update public.follow_circles set owner_id=p_user where id=p_circle;
end;$$;
-- Progress is returned only for visible members of Circles the caller currently belongs to.
-- No private SOS text is ever selected or returned.
create function public.follow_circle_progress(p_circle uuid,p_limit integer default 20,p_offset integer default 0)
returns table(user_id uuid,display_name text,current_day integer,completed_days integer,current_day_done boolean)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not circles_private.is_member(p_circle,auth.uid()) then raise exception 'Not permitted';end if;
 return query
 select m.user_id,m.display_name,
  greatest(1,least(365,coalesce((select max(value::int) from public.sos_daily_progress s
   where s.user_id=m.user_id and s.field_name='cursor' and s.value ~ '^[0-9]{1,3}$'),1))) as current_day,
  (select count(*)::integer from
   (select day_no from public.sos_daily_progress s where s.user_id=m.user_id
    group by day_no having count(*) filter(where field_name='read' and value='true')>0
    and count(*) filter(where field_name='insight' and value='true')>0
    and count(*) filter(where field_name='say' and length(trim(value))>0)>0
    and count(*) filter(where field_name='obey' and length(trim(value))>0)>0
    and count(*) filter(where field_name='share' and length(trim(value))>0)>0) d) as completed_days
 ,
  exists(select 1 from (select
    count(*) filter(where field_name='read' and value='true')>0
    and count(*) filter(where field_name='insight' and value='true')>0
    and count(*) filter(where field_name='say' and length(trim(value))>0)>0
    and count(*) filter(where field_name='obey' and length(trim(value))>0)>0
    and count(*) filter(where field_name='share' and length(trim(value))>0)>0 as finished
    from public.sos_daily_progress s
    where s.user_id=m.user_id and s.day_no=greatest(1,least(365,coalesce(
    (select max(value::int) from public.sos_daily_progress cur where cur.user_id=m.user_id and cur.field_name='cursor' and cur.value ~ '^[0-9]{1,3}$'),1)))) x
  where x.finished) as current_day_done
 from public.follow_circle_members m where m.circle_id=p_circle and m.progress_visible=true
 order by m.joined_at,m.user_id limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end;$$;
-- Mentions must target actual Circle members.
create function circles_private.validate_mentions() returns trigger language plpgsql
security definer set search_path=''
as $$
begin
 if exists(select 1 from unnest(new.mentioned_user_ids) as mentioned_id
  where mentioned_id=new.author_id or not exists(
   select 1 from public.follow_circle_members m where m.circle_id=new.circle_id and m.user_id=mentioned_id))
 then raise exception 'Mentions must target other Circle members';end if;
 return new;
end;$$;
create trigger follow_circle_mentions_valid before insert or update of mentioned_user_ids,circle_id on public.follow_circle_posts
 for each row execute function circles_private.validate_mentions();
-- Queue event IDs only; no post body, email address or private journal.
create function circles_private.queue_post_emails() returns trigger language plpgsql
security definer set search_path=''
as $$
declare parent_author uuid;
begin
 if new.parent_id is not null then
  select author_id into parent_author from public.follow_circle_posts where id=new.parent_id and circle_id=new.circle_id;
  if parent_author is not null and parent_author<>new.author_id and exists(
   select 1 from public.follow_circle_members m where m.circle_id=new.circle_id
    and m.user_id=parent_author and m.email_replies=true)
   and not exists(select 1 from public.follow_circle_blocks b where b.user_id=parent_author and b.blocked_user_id=new.author_id)
  then
   insert into public.follow_circle_email_outbox(user_id,circle_id,post_id,kind)
   values(parent_author,new.circle_id,new.id,'reply') on conflict do nothing;
  end if;
 end if;
 insert into public.follow_circle_email_outbox(user_id,circle_id,post_id,kind)
 select m.user_id,new.circle_id,new.id,'mention' from public.follow_circle_members m
 where m.circle_id=new.circle_id and m.email_mentions=true
 and m.user_id=any(new.mentioned_user_ids) and m.user_id<>new.author_id
 and not exists(select 1 from public.follow_circle_blocks b where b.user_id=m.user_id and b.blocked_user_id=new.author_id)
 on conflict do nothing;
 return new;
end;$$;
create trigger follow_circle_queue_email after insert on public.follow_circle_posts
 for each row execute function circles_private.queue_post_emails();
-- Throttle direct database API traffic as well as the browser UI.
create function circles_private.limit_posts() returns trigger language plpgsql
security definer set search_path=''
as $$
begin
 if (select count(*) from public.follow_circle_posts where author_id=new.author_id and created_at>now()-interval '1 minute')>=12
 or (select count(*) from public.follow_circle_posts where author_id=new.author_id and created_at>now()-interval '1 day')>=250
 then raise exception 'Too many messages; try again later';end if;
 return new;
end;$$;
create trigger follow_circle_limit_post_trigger before insert on public.follow_circle_posts
 for each row execute function circles_private.limit_posts();

-- Public access revoked for privileged functions, including preview unless anonymous preview explicitly permitted.
revoke all on function public.follow_circle_create(text,text),public.follow_circle_join(text,text),public.follow_circle_invite_preview(text),public.follow_circle_new_invite(uuid),public.follow_circle_revoke_invites(uuid),public.follow_circle_leave(uuid),public.follow_circle_remove(uuid,uuid),public.follow_circle_transfer(uuid,uuid),public.follow_circle_progress(uuid,integer,integer) from public;
grant execute on function public.follow_circle_create(text,text),public.follow_circle_join(text,text),public.follow_circle_new_invite(uuid),public.follow_circle_revoke_invites(uuid),public.follow_circle_leave(uuid),public.follow_circle_remove(uuid,uuid),public.follow_circle_transfer(uuid,uuid),public.follow_circle_progress(uuid,integer,integer) to authenticated;
grant execute on function public.follow_circle_invite_preview(text) to anon,authenticated;
