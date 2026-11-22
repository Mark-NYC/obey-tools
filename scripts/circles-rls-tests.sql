-- Run only in ephemeral CI database. Every test runs with actual authenticated role.
\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select (public.follow_circle_create('Friends Circle','Alice')->>'circle_id')::uuid as circle_a \gset
select (public.follow_circle_create('Other Circle','Alice')->>'circle_id')::uuid as circle_b \gset
select set_config('test.circle_a', :'circle_a',false),set_config('test.circle_b', :'circle_b',false);
-- Generate a valid secret link for independent join.
select public.follow_circle_new_invite(current_setting('test.circle_a')::uuid) as invite_token \gset
select set_config('test.invite_token', :'invite_token',false);
-- Alice can write in each Circle.
insert into public.follow_circle_posts(circle_id,author_id,body,reading_day) values
 (current_setting('test.circle_a')::uuid,auth.uid(),'Circle A reflection',5),
 (current_setting('test.circle_b')::uuid,auth.uid(),'Circle B reflection',5);
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
-- Bob cannot view either Circle before joining.
do $$
begin
 if exists(select 1 from public.follow_circle_posts) then raise exception 'FAIL: unauthorized posts visible';end if;
 if exists(select 1 from public.follow_circle_members) then raise exception 'FAIL: unauthorized members visible';end if;
 if exists(select 1 from public.sos_daily_progress where user_id='11111111-1111-4111-8111-111111111111') then
  raise exception 'FAIL: Alice private progress visible';
 end if;
end;$$;
select public.follow_circle_join(:'invite_token','Bob') as joined \gset
do $$
begin
 if (select count(*) from public.follow_circles)<>1 then raise exception 'FAIL: Circle privacy';end if;
 if (select count(*) from public.follow_circle_posts)<>1 then raise exception 'FAIL: cross-Circle post privacy';end if;
 if not exists(select 1 from public.follow_circle_members where user_id=auth.uid()) then raise exception 'FAIL: missing membership';end if;
end;$$;
-- Only aggregated daily progress is available, not private answers.
select current_day,current_day_done,completed_days from public.follow_circle_progress(current_setting('test.circle_a')::uuid,20,0)
 where user_id='11111111-1111-4111-8111-111111111111' \gset
select set_config('test.current_day', :'current_day',false),set_config('test.current_day_done', :'current_day_done',false),set_config('test.completed_days', :'completed_days',false);
do $$
begin
 if current_setting('test.current_day')::int<>5 or current_setting('test.current_day_done')::boolean<>true or current_setting('test.completed_days')::int<>1 then
  raise exception 'FAIL: daily completion summary incorrect';
 end if;
end;$$;
-- Bob's reaction is allowed, direct role modification is prohibited by column privileges.
do $$
begin
 begin
  update public.follow_circle_members set role='steward'
  where circle_id=current_setting('test.circle_a')::uuid and user_id=auth.uid();
  raise exception 'FAIL: self-promotion succeeded';
 exception when insufficient_privilege then null;end;
end;$$;
-- No user can read invitation hashes, even with a valid link.
do $$
begin
 begin
  perform count(*) from public.follow_circle_invites;
  raise exception 'FAIL: invitation hashes exposed';
 exception when insufficient_privilege then null;end;
end;$$;
-- Bob cannot see Circle B through the restricted summary function.
do $$
begin
 begin
  perform count(*) from public.follow_circle_progress(current_setting('test.circle_b')::uuid);
  raise exception 'FAIL: unauthorized progress returned';
 exception when others then
  if SQLERRM not like '%Not permitted%' then raise;end if;
 end;
end;$$;
-- Member creates own second Circle and can share privately there.
select (public.follow_circle_create('Bob Group','Bob')->>'circle_id')::uuid as circle_c \gset
select set_config('test.circle_c', :'circle_c',false);
insert into public.follow_circle_posts(circle_id,author_id,body,reading_day) values
(current_setting('test.circle_a')::uuid,auth.uid(),'Shared by explicit action',5),
(current_setting('test.circle_c')::uuid,auth.uid(),'Shared by explicit action',5);
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
-- Charlie is unauthorized everywhere.
do $$
begin
 if exists(select 1 from public.follow_circle_posts) then raise exception 'FAIL: Charlie saw posts';end if;
 begin
  insert into public.follow_circle_posts(circle_id,author_id,body) values
   (current_setting('test.circle_a')::uuid,auth.uid(),'Unauthorized');
  raise exception 'FAIL: Charlie posted without membership';
 exception when insufficient_privilege or check_violation then null;
 when others then
  if SQLSTATE not in ('42501','23514') then raise;end if;
 end;
end;$$;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
-- Steward removes Bob, who cannot bypass removal by reusing old link.
select public.follow_circle_remove(current_setting('test.circle_a')::uuid,'22222222-2222-4222-8222-222222222222');
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$
begin
 if exists(select 1 from public.follow_circle_posts where circle_id=current_setting('test.circle_a')::uuid) then raise exception 'FAIL: removed member can read';end if;
 begin
  perform public.follow_circle_join(current_setting('test.invite_token'),'Bob');
  raise exception 'FAIL: removed member rejoined';
 exception when others then
  if SQLERRM not like '%Membership invitation not available%' then raise;end if;
 end;
end;$$;
reset role;
select 'FOLLOW CIRCLES SECURITY CONTRACT PASSED' as result;
