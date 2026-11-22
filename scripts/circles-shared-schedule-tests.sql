\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select (public.follow_circle_create_scheduled('New Reading Circle','Alice',28,'America/New_York')->>'circle_id')::uuid as first_id \gset
select set_config('test.new_circle',:'first_id',false);
do $$
begin
 if (select day_no from public.follow_circle_schedule() where circle_id=current_setting('test.new_circle')::uuid)<>28
 then raise exception 'FAIL: new Circle did not begin on chosen Day 28';end if;
 if (select time_zone from public.follow_circle_schedule() where circle_id=current_setting('test.new_circle')::uuid)<>'America/New_York'
 then raise exception 'FAIL: timezone';end if;
 if (select count(*) from public.follow_circle_schedule() where is_primary)<>1
 then raise exception 'FAIL: existing primary Circle was lost';end if;
end;$$;
-- Explicitly choose the new scheduled Circle. Creating another must not change it.
select public.follow_circle_set_primary(current_setting('test.new_circle')::uuid);
select (public.follow_circle_create_scheduled('Second Circle','Alice',1,'UTC')->>'circle_id')::uuid as second_id \gset
select set_config('test.second_circle',:'second_id',false);
do $$
begin
 if (select day_no from public.follow_circle_schedule() where circle_id=current_setting('test.second_circle')::uuid)<>1
 then raise exception 'FAIL: Day 1 start option';end if;
 if (select circle_id from public.follow_circle_primary where user_id=auth.uid())<>current_setting('test.new_circle')::uuid
 then raise exception 'FAIL: creating second Circle changed primary';end if;
end;$$;
select public.follow_circle_set_primary(current_setting('test.second_circle')::uuid);
do $$
begin
 if (select circle_id from public.follow_circle_primary where user_id=auth.uid())<>current_setting('test.second_circle')::uuid
 then raise exception 'FAIL: explicit primary switch';end if;
end;$$;
-- No one may select a Circle without membership.
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$
begin
 begin
  perform public.follow_circle_set_primary(current_setting('test.new_circle')::uuid);
  raise exception 'FAIL: nonmember changed primary';
 exception when others then
  if SQLERRM not like '%Not a member%' then raise;end if;
 end;
 if exists(select 1 from public.follow_circle_schedule() where circle_id=current_setting('test.new_circle')::uuid) then
  raise exception 'FAIL: nonmember can see another Circle schedule';end if;
end;$$;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.follow_circle_new_invite(current_setting('test.new_circle')::uuid) as join_token \gset
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.follow_circle_join(:'join_token','Charlie');
do $$
begin
 if (select circle_id from public.follow_circle_primary where user_id=auth.uid())<>current_setting('test.new_circle')::uuid
 then raise exception 'FAIL: first joined Circle not primary';end if;
 if (select day_no from public.follow_circle_schedule() where is_primary)<>28
 then raise exception 'FAIL: late join day';end if;
end;$$;
-- Date advances in the Circle timezone, independent of individual progress.
reset role;
update public.follow_circles set start_on=(now() at time zone 'America/New_York')::date-7
where id=current_setting('test.new_circle')::uuid;
set role authenticated;
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$
begin
 if (select day_no from public.follow_circle_schedule() where is_primary)<>35
 then raise exception 'FAIL: shared schedule did not advance seven days';end if;
end;$$;
reset role;
select 'SHARED CIRCLE SCHEDULE CONTRACTS PASSED' as result;
