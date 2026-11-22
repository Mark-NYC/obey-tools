-- Isolated PostgreSQL CI harness for the Supabase-specific auth contract.
-- Never run against production.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key,email text not null);
create function auth.uid() returns uuid language sql stable as
$$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table public.sos_daily_progress(
 user_id uuid not null references auth.users(id),
 day_no integer not null check(day_no between 1 and 365),
 field_name text not null,
 value text not null,
 revision_ms bigint default 0,
 saved_at timestamptz default now(),
 primary key(user_id,day_no,field_name)
);
alter table public.sos_daily_progress enable row level security;
create policy progress_own on public.sos_daily_progress for all to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update,delete on public.sos_daily_progress to authenticated;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','alice@example.test'),
 ('22222222-2222-4222-8222-222222222222','bob@example.test'),
 ('33333333-3333-4333-8333-333333333333','charlie@example.test');
insert into public.sos_daily_progress(user_id,day_no,field_name,value) values
 ('11111111-1111-4111-8111-111111111111',1,'cursor','5'),
 ('11111111-1111-4111-8111-111111111111',5,'read','true'),
 ('11111111-1111-4111-8111-111111111111',5,'insight','true'),
 ('11111111-1111-4111-8111-111111111111',5,'say','PRIVATE-SAY'),
 ('11111111-1111-4111-8111-111111111111',5,'obey','PRIVATE-OBEY'),
 ('11111111-1111-4111-8111-111111111111',5,'share','PRIVATE-SHARE'),
 ('22222222-2222-4222-8222-222222222222',1,'cursor','3');
