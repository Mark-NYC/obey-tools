-- Circle activities and daily-reading rules. Ephemeral CI database only.
-- Runs after circles-conversations-tests.sql and the activities migration.
\set ON_ERROR_STOP on
insert into auth.users(id,email) values
 ('66666666-6666-4666-8666-666666666666','fiona@example.test'),
 ('77777777-7777-4777-8777-777777777777','gabe@example.test'),
 ('88888888-8888-4888-8888-888888888888','hal@example.test');
create or replace function pg_temp.must_fail(p_sql text,p_label text) returns void language plpgsql as $$
begin
 begin execute p_sql; exception when others then return; end;
 raise exception 'FAIL: %',p_label;
end;$$;
create or replace function pg_temp.primary_of(p_user uuid) returns text language sql as $$
 select coalesce((select coalesce(c.name,'OWN PACE') from public.follow_circle_primary p left join public.follow_circles c on c.id=p.circle_id where p.user_id=p_user),'NONE')$$;

-- Existing Circles keep everything they could do.
do $$begin
 if exists(select 1 from public.follow_circles where not uses_reading or not uses_conversations) then raise exception 'FAIL: existing Circles lost an activity';end if;
end$$;

set role authenticated;
-- Fiona: no Circles yet.
set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';
do $$begin
 if exists(select 1 from public.follow_circle_schedule()) then raise exception 'FAIL: schedule without Circles';end if;
end$$;
-- A Conversations-only Circle never becomes her daily reading.
select (public.follow_circle_create_with('Campus Outreach','Fiona',false,true,null,null)->>'circle_id') as outreach \gset
select set_config('t.outreach', :'outreach',false);
reset role;
do $$begin
 if pg_temp.primary_of('66666666-6666-4666-8666-666666666666')<>'NONE' then raise exception 'FAIL: Conversations-only Circle became daily reading';end if;
end$$;
set role authenticated;
set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';
do $$begin
 if exists(select 1 from public.follow_circle_schedule()) then raise exception 'FAIL: Conversations-only Circle has a reading schedule';end if;
end$$;
select pg_temp.must_fail(format('select public.follow_circle_set_primary(%L)',current_setting('t.outreach')),'Conversations-only Circle set as daily reading');
select pg_temp.must_fail(format($q$insert into public.follow_circle_posts(circle_id,author_id,body,reading_day) values(%L,auth.uid(),'x',5)$q$,current_setting('t.outreach')),'reflection in a Circle without FOLLOW DAILY');
select pg_temp.must_fail($q$select public.follow_circle_create_with('Nothing Circle','Fiona',false,false,1,'UTC')$q$,'Circle with no activity');

-- Her first FOLLOW DAILY Circle becomes her daily reading.
select (public.follow_circle_create_with('Tuesday Bible Study','Fiona',true,false,1,'America/New_York')->>'circle_id') as tuesday \gset
select set_config('t.tuesday', :'tuesday',false);
do $$begin
 if (select count(*) from public.follow_circle_schedule())<>1 or not (select is_primary from public.follow_circle_schedule()) then raise exception 'FAIL: first reading Circle not primary';end if;
end$$;
select pg_temp.must_fail(format($q$insert into public.follow_circle_steps(circle_id,user_id,to_stage) values(%L,auth.uid(),'casual')$q$,current_setting('t.tuesday')),'step in a Circle without Conversations');

-- Gabe runs two Circles that started earlier (late joiners enter the current day).
set request.jwt.claim.sub='77777777-7777-4777-8777-777777777777';
select (public.follow_circle_create_with('Neighborhood Disciples','Gabe',true,true,50,'UTC')->>'circle_id') as hood \gset
select (public.follow_circle_create_with('Campus Readers','Gabe',true,true,1,'UTC')->>'circle_id') as campus \gset
select set_config('t.hood', :'hood',false),set_config('t.campus', :'campus',false);
select public.follow_circle_new_invite(current_setting('t.hood')::uuid) as hood_token \gset
select public.follow_circle_new_invite(current_setting('t.campus')::uuid) as campus_token \gset
select set_config('t.hood_token', :'hood_token',false),set_config('t.campus_token', :'campus_token',false);
reset role;
update public.follow_circles set start_on=current_date-13 where id=current_setting('t.hood')::uuid;
set role authenticated;

-- Joining another reading Circle never replaces the daily reading.
set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';
select public.follow_circle_join(current_setting('t.hood_token'),'Fiona');
do $$
declare h record;
begin
 select * into h from public.follow_circle_schedule() where circle_id=current_setting('t.hood')::uuid;
 if h.day_no<>63 then raise exception 'FAIL: late joiner should be on Day 63, got %',h.day_no;end if;
 if h.is_primary then raise exception 'FAIL: joining replaced the daily reading';end if;
end$$;
reset role;
do $$begin if pg_temp.primary_of('66666666-6666-4666-8666-666666666666')<>'Tuesday Bible Study' then raise exception 'FAIL: daily reading changed on join';end if;end$$;
set role authenticated;
set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';

-- Choosing on purpose.
select public.follow_circle_set_primary(current_setting('t.hood')::uuid);
reset role;
do $$begin if pg_temp.primary_of('66666666-6666-4666-8666-666666666666')<>'Neighborhood Disciples' then raise exception 'FAIL: set primary';end if;end$$;
set role authenticated;
set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';
-- Own pace survives joining another reading Circle.
select public.follow_circle_set_independent();
select public.follow_circle_join(current_setting('t.campus_token'),'Fiona');
reset role;
do $$begin if pg_temp.primary_of('66666666-6666-4666-8666-666666666666')<>'OWN PACE' then raise exception 'FAIL: own pace overridden by joining';end if;end$$;
set role authenticated;
set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';
do $$begin
 if exists(select 1 from public.follow_circle_schedule() where is_primary) then raise exception 'FAIL: own pace shows a primary';end if;
 if (select count(*) from public.follow_circle_schedule())<>3 then raise exception 'FAIL: schedule should list 3 reading Circles';end if;
end$$;

-- Leaving the daily-reading Circle falls back to the next reading Circle.
select public.follow_circle_set_primary(current_setting('t.tuesday')::uuid);
insert into public.follow_circle_posts(circle_id,author_id,body,reading_day) values(current_setting('t.hood')::uuid,auth.uid(),'Earlier reflection',63);
select public.follow_circle_leave(current_setting('t.tuesday')::uuid);
reset role;
do $$begin if pg_temp.primary_of('66666666-6666-4666-8666-666666666666')<>'Neighborhood Disciples' then raise exception 'FAIL: leaving primary did not fall back, got %',pg_temp.primary_of('66666666-6666-4666-8666-666666666666');end if;end$$;
set role authenticated;

-- Only the steward changes activities; at least one must stay on.
set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';
select pg_temp.must_fail(format('select public.follow_circle_set_activities(%L,false,true)',current_setting('t.hood')),'member changed activities');
set request.jwt.claim.sub='77777777-7777-4777-8777-777777777777';
select pg_temp.must_fail(format('select public.follow_circle_set_activities(%L,false,false)',current_setting('t.hood')),'all activities turned off');
-- Turning FOLLOW DAILY off: hidden from schedules, daily readings move, nothing deleted.
select public.follow_circle_set_activities(current_setting('t.hood')::uuid,false,true);
reset role;
do $$begin
 if pg_temp.primary_of('66666666-6666-4666-8666-666666666666')<>'Campus Readers' then raise exception 'FAIL: daily reading did not move when FOLLOW DAILY turned off';end if;
 if not exists(select 1 from public.follow_circle_posts where body='Earlier reflection') then raise exception 'FAIL: earlier reflection deleted';end if;
end$$;
set role authenticated;
set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';
do $$begin
 if exists(select 1 from public.follow_circle_schedule() where circle_id=current_setting('t.hood')::uuid) then raise exception 'FAIL: reading schedule still shown';end if;
 if not exists(select 1 from public.follow_circle_posts where body='Earlier reflection') then raise exception 'FAIL: members lost earlier reflection';end if;
end$$;
select pg_temp.must_fail(format($q$insert into public.follow_circle_posts(circle_id,author_id,body,reading_day) values(%L,auth.uid(),'x',64)$q$,current_setting('t.hood')),'new reflection after FOLLOW DAILY off');
insert into public.follow_circle_posts(circle_id,author_id,body) values(current_setting('t.hood')::uuid,auth.uid(),'Prayer and plans still work');
insert into public.follow_circle_steps(circle_id,user_id,from_stage,to_stage) values(current_setting('t.hood')::uuid,auth.uid(),'casual','meaningful');

-- Turning FOLLOW DAILY back on resumes the same calendar; Conversations off keeps old steps.
set request.jwt.claim.sub='77777777-7777-4777-8777-777777777777';
select public.follow_circle_set_activities(current_setting('t.hood')::uuid,true,false);
set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';
do $$begin
 if (select day_no from public.follow_circle_schedule() where circle_id=current_setting('t.hood')::uuid)<>63 then raise exception 'FAIL: calendar not resumed';end if;
 if (select is_primary from public.follow_circle_schedule() where circle_id=current_setting('t.hood')::uuid) then raise exception 'FAIL: re-enabling stole the daily reading';end if;
end$$;
select pg_temp.must_fail(format($q$insert into public.follow_circle_steps(circle_id,user_id,to_stage) values(%L,auth.uid(),'casual')$q$,current_setting('t.hood')),'step after Conversations off');
select pg_temp.must_fail(format($q$insert into public.follow_circle_posts(circle_id,author_id,body,kind,prayer_initials,prayer_stage) values(%L,auth.uid(),'x','prayer','J. K.','casual')$q$,current_setting('t.hood')),'prayer after Conversations off');
select pg_temp.must_fail(format($q$select public.follow_circle_commit(%L,date_trunc('week',current_date)::date,1)$q$,current_setting('t.hood')),'huddle goal after Conversations off');
reset role;
do $$begin
 if (select count(*) from public.follow_circle_steps where circle_id=current_setting('t.hood')::uuid)<>1 then raise exception 'FAIL: earlier steps deleted';end if;
end$$;

-- Day 365: finished, still listed.
update public.follow_circles set start_day=360,start_on=current_date-10 where id=current_setting('t.campus')::uuid;
set role authenticated;
set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';
do $$
declare c record;
begin
 select * into c from public.follow_circle_schedule() where circle_id=current_setting('t.campus')::uuid;
 if c.day_no<>365 or not c.finished then raise exception 'FAIL: Day 365 handling %',c;end if;
end$$;

-- Removal from the daily-reading Circle falls back too.
set request.jwt.claim.sub='77777777-7777-4777-8777-777777777777';
select public.follow_circle_remove(current_setting('t.campus')::uuid,'66666666-6666-4666-8666-666666666666');
reset role;
do $$begin if pg_temp.primary_of('66666666-6666-4666-8666-666666666666')<>'Neighborhood Disciples' then raise exception 'FAIL: removal did not fall back, got %',pg_temp.primary_of('66666666-6666-4666-8666-666666666666');end if;end$$;

-- Isolation: Hal in Campus only sees nothing from Neighborhood or Outreach.
set role authenticated;
set request.jwt.claim.sub='88888888-8888-4888-8888-888888888888';
select public.follow_circle_join(current_setting('t.campus_token'),'Hal');
do $$begin
 if exists(select 1 from public.follow_circle_posts where circle_id in (current_setting('t.hood')::uuid,current_setting('t.outreach')::uuid)) then raise exception 'FAIL: posts leaked across Circles';end if;
 if exists(select 1 from public.follow_circles where id in (current_setting('t.hood')::uuid,current_setting('t.outreach')::uuid)) then raise exception 'FAIL: Circles leaked';end if;
 if (select count(*) from public.follow_circle_schedule())<>1 then raise exception 'FAIL: Hal schedule';end if;
end$$;
select pg_temp.must_fail(format('select public.follow_circle_cb_summary(%L)',current_setting('t.hood')),'outsider summary');
reset role;
do $$begin if pg_temp.primary_of('88888888-8888-4888-8888-888888888888')<>'Campus Readers' then raise exception 'FAIL: Hal primary';end if;end$$;
-- Deleting an account is not blocked by the fallback.
delete from auth.users where id='88888888-8888-4888-8888-888888888888';
do $$begin
 if exists(select 1 from public.follow_circle_primary where user_id='88888888-8888-4888-8888-888888888888') then raise exception 'FAIL: deleted account kept a daily reading';end if;
end$$;
select 'CIRCLE ACTIVITIES AND DAILY READING CONTRACTS PASSED' as result;
