-- Conversation Box × Circles and church contracts. Ephemeral CI database only.
-- Runs after circles-rls-tests.sql and circles-shared-schedule-tests.sql.
\set ON_ERROR_STOP on
-- Users: Alice 1111 (steward), Bob 2222 (member), Charlie 3333 (outsider),
-- Dana 4444 (church admin), Evan 5555 (member, not steward).
set role authenticated;

-- Each test expects failure: helper that asserts a statement raises.
create or replace function pg_temp.must_fail(p_sql text,p_label text) returns void language plpgsql as $$
begin
 begin execute p_sql; exception when others then return; end;
 raise exception 'FAIL: %',p_label;
end;$$;

set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select (public.follow_circle_create('Conversation Circle','Alice')->>'circle_id')::uuid as cc \gset
select set_config('test.cc', :'cc',false);
select id as other_circle from public.follow_circles where name='Other Circle' \gset
select set_config('test.other_circle', :'other_circle',false);
select public.follow_circle_new_invite(current_setting('test.cc')::uuid) as cc_token \gset
select set_config('test.cc_token', :'cc_token',false);
insert into public.conversation_people(user_id,person_name,box_name) values
 (auth.uid(),'SECRET-ALICE-1','casual'),(auth.uid(),'SECRET-ALICE-2','casual'),
 (auth.uid(),'SECRET-ALICE-3','spiritual'),(auth.uid(),'SECRET-ALICE-4','discovery');
update public.follow_circle_members set share_conversations=true
 where circle_id=current_setting('test.cc')::uuid and user_id=auth.uid();

set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.follow_circle_join(current_setting('test.cc_token'),'Bob');
insert into public.conversation_people(user_id,person_name,box_name) values
 (auth.uid(),'SECRET-BOB-1','meaningful'),(auth.uid(),'SECRET-BOB-2','meaningful');

-- Totals count only members who opted in; names never appear.
do $$
declare v jsonb:=public.follow_circle_cb_summary(current_setting('test.cc')::uuid);
begin
 if (v->'totals'->>'casual')::int<>2 or (v->'totals'->>'meaningful')::int<>0
  or (v->'totals'->>'spiritual')::int<>1 or (v->'totals'->>'discovery')::int<>1
 then raise exception 'FAIL: totals must include only opted-in members: %',v;end if;
 if (v->>'sharing_members')::int<>1 or (v->>'members')::int<>2 then raise exception 'FAIL: member counts %',v;end if;
 if v::text like '%SECRET%' then raise exception 'FAIL: summary leaked a name';end if;
end;$$;
-- Bob cannot read Alice's people.
do $$begin
 if exists(select 1 from public.conversation_people where person_name like 'SECRET-ALICE%') then raise exception 'FAIL: people visible across accounts';end if;
end;$$;

-- Shared steps: forward only, own account only, members only.
insert into public.follow_circle_steps(circle_id,user_id,from_stage,to_stage) values
 (current_setting('test.cc')::uuid,auth.uid(),'casual','meaningful'),
 (current_setting('test.cc')::uuid,auth.uid(),null,'casual'),
 (current_setting('test.cc')::uuid,auth.uid(),'spiritual','discovery');
insert into public.follow_circle_steps(circle_id,user_id,from_stage,to_stage,response) values
 (current_setting('test.cc')::uuid,auth.uid(),'spiritual','discovery','trusted');
select pg_temp.must_fail(format($q$insert into public.follow_circle_steps(circle_id,user_id,from_stage,to_stage) values(%L,auth.uid(),'spiritual','casual')$q$,current_setting('test.cc')),'backward step accepted');
select pg_temp.must_fail(format($q$insert into public.follow_circle_steps(circle_id,user_id,from_stage,to_stage,response) values(%L,auth.uid(),'casual','meaningful','trusted')$q$,current_setting('test.cc')),'response outside Discovery accepted');
select pg_temp.must_fail(format($q$insert into public.follow_circle_steps(circle_id,user_id,to_stage) values(%L,'11111111-1111-4111-8111-111111111111','casual')$q$,current_setting('test.cc')),'step written for another user');
select pg_temp.must_fail(format($q$insert into public.follow_circle_steps(circle_id,user_id,to_stage) values(%L,auth.uid(),'casual')$q$,current_setting('test.other_circle')),'step into a Circle without membership');
select pg_temp.must_fail($q$select count(*) from public.follow_circle_steps$q$,'steps table readable directly');
select pg_temp.must_fail(format($q$insert into public.follow_circle_steps(circle_id,user_id,to_stage,created_at) values(%L,auth.uid(),'casual','2020-01-01')$q$,current_setting('test.cc')),'step backdating allowed');

-- Weekly goals: a number on a Monday, members only.
select public.follow_circle_commit(current_setting('test.cc')::uuid,date_trunc('week',current_date)::date,3);
select public.follow_circle_commit(current_setting('test.cc')::uuid,date_trunc('week',current_date)::date,2);
select pg_temp.must_fail(format($q$select public.follow_circle_commit(%L,(date_trunc('week',current_date)+interval '1 day')::date,2)$q$,current_setting('test.cc')),'non-Monday week accepted');
select pg_temp.must_fail(format($q$select public.follow_circle_commit(%L,date_trunc('week',current_date)::date,99)$q$,current_setting('test.cc')),'goal over 50 accepted');
select pg_temp.must_fail(format($q$select public.follow_circle_commit(%L,(date_trunc('week',current_date)-interval '28 days')::date,1)$q$,current_setting('test.cc')),'old week accepted');
select pg_temp.must_fail(format($q$insert into public.follow_circle_commitments(circle_id,user_id,week_start,goal) values(%L,auth.uid(),date_trunc('week',current_date)::date,1)$q$,current_setting('test.cc')),'commitments writable directly');
do $$begin
 if (select goal from public.follow_circle_commitments where user_id=auth.uid())<>2 then raise exception 'FAIL: goal not updated';end if;
end;$$;

-- Prayer requests: initials only, never a full name.
insert into public.follow_circle_posts(circle_id,author_id,body,kind,prayer_initials,prayer_stage)
 values(current_setting('test.cc')::uuid,auth.uid(),'Reading John 3 on Friday','prayer','J. K.','spiritual');
insert into public.follow_circle_posts(circle_id,author_id,body,kind,prayer_initials,prayer_stage)
 values(current_setting('test.cc')::uuid,auth.uid(),'Lost her job','prayer','M.','meaningful');
select pg_temp.must_fail(format($q$insert into public.follow_circle_posts(circle_id,author_id,body,kind,prayer_initials,prayer_stage) values(%L,auth.uid(),'x','prayer','Jonah Kim','spiritual')$q$,current_setting('test.cc')),'full name accepted as initials');
select pg_temp.must_fail(format($q$insert into public.follow_circle_posts(circle_id,author_id,body,kind,prayer_initials,prayer_stage) values(%L,auth.uid(),'x','prayer','Jonah','spiritual')$q$,current_setting('test.cc')),'first name accepted as initials');
select pg_temp.must_fail(format($q$insert into public.follow_circle_posts(circle_id,author_id,body,kind,prayer_initials,prayer_stage) values(%L,auth.uid(),'x','prayer','J. K.','heaven')$q$,current_setting('test.cc')),'unknown stage accepted');
select pg_temp.must_fail(format($q$insert into public.follow_circle_posts(circle_id,author_id,body,kind,prayer_initials,prayer_stage,reading_day) values(%L,auth.uid(),'x','prayer','J.','casual',5)$q$,current_setting('test.cc')),'prayer tied to a reading');
select pg_temp.must_fail(format($q$insert into public.follow_circle_posts(circle_id,author_id,body,prayer_initials) values(%L,auth.uid(),'x','J.')$q$,current_setting('test.cc')),'ordinary post with initials');
select pg_temp.must_fail(format($q$insert into public.follow_circle_posts(circle_id,author_id,body,kind,prayer_initials,prayer_stage) values(%L,auth.uid(),repeat('x',281),'prayer','J.','casual')$q$,current_setting('test.cc')),'prayer longer than 280 characters');
select pg_temp.must_fail($q$update public.follow_circle_posts set kind='post',prayer_initials=null,prayer_stage=null where kind='prayer'$q$,'prayer kind editable');

set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
-- Alice sees Bob's steps with his Circle name, and his prayer requests.
do $$
declare n int;
begin
 select count(*) into n from public.follow_circle_cb_activity(current_setting('test.cc')::uuid,14) where display_name='Bob';
 if n<>4 then raise exception 'FAIL: activity expected 4 steps, got %',n;end if;
 if (select count(*) from public.follow_circle_posts where kind='prayer' and circle_id=current_setting('test.cc')::uuid)<>2 then raise exception 'FAIL: prayer requests not visible to members';end if;
end;$$;
do $$
declare v jsonb:=public.follow_circle_cb_summary(current_setting('test.cc')::uuid);
begin
 if (v->'week'->>'meaningful')::int<>1 or (v->'week'->>'casual')::int<>1 or (v->'week'->>'discovery')::int<>2 or (v->'week'->>'trusted')::int<>1
 then raise exception 'FAIL: weekly steps %',v;end if;
 if (v->>'goals')::int<>2 or (v->>'committed_members')::int<>1 then raise exception 'FAIL: weekly goals %',v;end if;
end;$$;
-- Goals stay private per person.
do $$begin
 if exists(select 1 from public.follow_circle_commitments) then raise exception 'FAIL: another member''s goal visible';end if;
end;$$;
-- Blocking hides that member's activity from the blocker.
insert into public.follow_circle_blocks(user_id,blocked_user_id) values(auth.uid(),'22222222-2222-4222-8222-222222222222');
do $$begin
 if exists(select 1 from public.follow_circle_cb_activity(current_setting('test.cc')::uuid,14)) then raise exception 'FAIL: blocked member activity visible';end if;
end;$$;
delete from public.follow_circle_blocks where user_id=auth.uid();

-- Outsiders get nothing.
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select pg_temp.must_fail(format('select public.follow_circle_cb_summary(%L)',current_setting('test.cc')),'outsider read summary');
select pg_temp.must_fail(format('select * from public.follow_circle_cb_activity(%L,14)',current_setting('test.cc')),'outsider read activity');
select pg_temp.must_fail(format('select public.follow_circle_commit(%L,date_trunc(''week'',current_date)::date,1)',current_setting('test.cc')),'outsider set a goal');
do $$begin
 if exists(select 1 from public.follow_circle_posts where kind='prayer') then raise exception 'FAIL: outsider sees prayer requests';end if;
end;$$;

-- ── Churches ────────────────────────────────────────────────────────────
set request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select public.follow_church_create('Grace Fellowship','Dana') as church \gset
select set_config('test.church', :'church',false);
select public.follow_church_new_invite(current_setting('test.church')::uuid,'circle') as circle_link \gset
select public.follow_church_new_invite(current_setting('test.church')::uuid,'admin') as admin_link \gset
select set_config('test.circle_link', :'circle_link',false),set_config('test.admin_link', :'admin_link',false);
do $$begin
 if (select count(*) from public.follow_church_overview(current_setting('test.church')::uuid))<>0 then raise exception 'FAIL: new church has Circles';end if;
end;$$;

-- Evan joins the Circle as a member; only the steward can link it.
set request.jwt.claim.sub='55555555-5555-4555-8555-555555555555';
select public.follow_circle_join(current_setting('test.cc_token'),'Evan');
do $$begin
 if public.follow_church_invite_preview(current_setting('test.circle_link'))->>'church_name'<>'Grace Fellowship' then raise exception 'FAIL: church preview';end if;
end;$$;
select pg_temp.must_fail(format('select public.follow_church_accept(%L,%L)',current_setting('test.circle_link'),current_setting('test.cc')),'member linked a Circle');

set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.follow_church_accept(current_setting('test.circle_link'),current_setting('test.cc')::uuid);
-- A Circle link cannot add admins, and an admin link needs a name.
select pg_temp.must_fail(format('select public.follow_church_overview(%L)',current_setting('test.church')),'steward became church admin');
do $$begin
 if (select name from public.follow_churches where id=current_setting('test.church')::uuid)<>'Grace Fellowship' then raise exception 'FAIL: linked member cannot see church name';end if;
end;$$;

set request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
do $$
declare r record;
begin
 select * into r from public.follow_church_overview(current_setting('test.church')::uuid);
 if r.circle_name<>'Conversation Circle' or r.steward_name<>'Alice' or r.members<>3 or r.sharing_members<>1 then raise exception 'FAIL: overview membership %',r;end if;
 if r.casual<>2 or r.meaningful<>0 or r.spiritual<>1 or r.discovery<>1 then raise exception 'FAIL: overview totals %',r;end if;
 if r.steps_30d<>4 or r.discovery_30d<>2 or r.trusted_30d<>1 or r.goals_week<>2 or r.last_huddle is null then raise exception 'FAIL: overview activity %',r;end if;
 if to_jsonb(r)::text like '%SECRET%' then raise exception 'FAIL: overview leaked a name';end if;
 -- Church admins are not Circle members: no posts, members or steps.
 if exists(select 1 from public.follow_circle_posts) or exists(select 1 from public.follow_circle_members) then raise exception 'FAIL: church admin reads Circle content';end if;
end;$$;
select pg_temp.must_fail(format('select public.follow_circle_cb_summary(%L)',current_setting('test.cc')),'church admin reads Circle summary');

-- Charlie becomes a second admin through the admin link.
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select pg_temp.must_fail(format('select public.follow_church_overview(%L)',current_setting('test.church')),'outsider reads church overview');
do $$begin
 if exists(select 1 from public.follow_churches) then raise exception 'FAIL: outsider sees church';end if;
end;$$;
select pg_temp.must_fail(format('select public.follow_church_accept(%L,null,null)',current_setting('test.admin_link')),'admin link accepted without a name');
select public.follow_church_accept(current_setting('test.admin_link'),null,'Charlie');
do $$begin
 if (select count(*) from public.follow_church_overview(current_setting('test.church')::uuid))<>1 then raise exception 'FAIL: second admin overview';end if;
 if (select count(*) from public.follow_church_admins)<>2 then raise exception 'FAIL: admins list';end if;
 if (select count(*) from public.follow_church_list())<>1 then raise exception 'FAIL: church list';end if;
end;$$;

-- A Circle linked elsewhere must be unlinked first; non-stewards cannot unlink.
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.follow_church_create('Other Church','Bob') as other_church \gset
select set_config('test.other_church', :'other_church',false);
select public.follow_church_new_invite(current_setting('test.other_church')::uuid,'circle') as other_link \gset
select set_config('test.other_link', :'other_link',false);
select pg_temp.must_fail(format('select public.follow_church_unlink(%L)',current_setting('test.cc')),'member unlinked a Circle');
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select pg_temp.must_fail(format('select public.follow_church_accept(%L,%L)',current_setting('test.other_link'),current_setting('test.cc')),'Circle linked to two churches');

-- Removing a member drops their steps and goals from what others see.
select public.follow_circle_remove(current_setting('test.cc')::uuid,'22222222-2222-4222-8222-222222222222');
do $$
declare v jsonb:=public.follow_circle_cb_summary(current_setting('test.cc')::uuid);
begin
 if (v->'week'->>'discovery')::int<>0 or (v->>'goals')::int<>0 then raise exception 'FAIL: removed member still counted %',v;end if;
end;$$;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.must_fail(format('select public.follow_circle_cb_summary(%L)',current_setting('test.cc')),'removed member reads summary');
select pg_temp.must_fail(format($q$insert into public.follow_circle_steps(circle_id,user_id,to_stage) values(%L,auth.uid(),'casual')$q$,current_setting('test.cc')),'removed member shares a step');

-- Admins can unlink; the last admin leaving closes the church and unlinks Circles.
set request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select public.follow_church_unlink(current_setting('test.cc')::uuid);
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.follow_church_accept(current_setting('test.circle_link'),current_setting('test.cc')::uuid);
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.follow_church_leave(current_setting('test.church')::uuid);
set request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select public.follow_church_leave(current_setting('test.church')::uuid);
select pg_temp.must_fail(format('select public.follow_church_new_invite(%L,''circle'')',current_setting('test.church')),'closed church issues links');
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$begin
 if (select church_id from public.follow_circles where id=current_setting('test.cc')::uuid) is not null then raise exception 'FAIL: closed church still linked';end if;
 if public.follow_church_invite_preview(current_setting('test.circle_link')) is not null then raise exception 'FAIL: closed church link still previews';end if;
end;$$;

-- Anonymous visitors cannot call any of it.
reset role;
set role anon;
select pg_temp.must_fail(format('select public.follow_circle_cb_summary(%L)',current_setting('test.cc')),'anon summary');
select pg_temp.must_fail(format('select public.follow_church_invite_preview(%L)',current_setting('test.circle_link')),'anon church preview');
select pg_temp.must_fail('select * from public.follow_church_list()','anon church list');
select pg_temp.must_fail('select count(*) from public.follow_churches','anon churches table');
reset role;
select 'CIRCLE CONVERSATIONS AND CHURCH CONTRACTS PASSED' as result;
