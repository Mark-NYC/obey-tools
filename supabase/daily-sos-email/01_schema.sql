-- Daily SOS email subscriptions, isolated from all other mailing programs.
-- Safe initial state: dispatch.enabled = false. Apply, deploy/test, then activate deliberately.
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.sos_email_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  timezone text not null default 'America/New_York',
  send_hour integer not null default 7 check (send_hour between 0 and 23),
  status text not null default 'active' check (status in ('active','paused','stopped','completed')),
  next_day integer not null default 1 check (next_day between 1 and 366),
  next_send_at timestamptz not null default now(),
  last_sent_at timestamptz,
  unsubscribe_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sos_email_canonical_email check (email = lower(trim(email)) and email like '%@%')
);
create index if not exists sos_email_due_idx on public.sos_email_subscriptions (next_send_at) where status = 'active' and next_day <= 365;
alter table public.sos_email_subscriptions enable row level security;

create or replace function public.sos_email_validate_write()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid IANA time zone';
  end if;
  if tg_op = 'INSERT' then
    new.email := lower(trim(new.email));
    if auth.uid() is not null and
      (new.user_id is distinct from auth.uid() or new.email is distinct from lower(coalesce(auth.jwt()->>'email',''))) then
      raise exception 'Subscription identity must match the authenticated email';
    end if;
    new.next_send_at := (((now() at time zone new.timezone)::date + 1) + make_time(new.send_hour, 0, 0)) at time zone new.timezone;
    new.next_day := 1;
  else
    new.updated_at := now();
    if new.status = 'active' and (old.status is distinct from new.status or old.timezone is distinct from new.timezone or old.send_hour is distinct from new.send_hour) then
      new.next_send_at := (((now() at time zone new.timezone)::date + 1) + make_time(new.send_hour, 0, 0)) at time zone new.timezone;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sos_email_subscriptions_write on public.sos_email_subscriptions;
create trigger sos_email_subscriptions_write before insert or update on public.sos_email_subscriptions
  for each row execute function public.sos_email_validate_write();

drop policy if exists sos_email_select_own on public.sos_email_subscriptions;
create policy sos_email_select_own on public.sos_email_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists sos_email_insert_own on public.sos_email_subscriptions;
create policy sos_email_insert_own on public.sos_email_subscriptions for insert to authenticated
  with check ((select auth.uid()) = user_id and email = lower(coalesce((select auth.jwt())->>'email','')));
drop policy if exists sos_email_update_own on public.sos_email_subscriptions;
create policy sos_email_update_own on public.sos_email_subscriptions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and email = lower(coalesce((select auth.jwt())->>'email','')));

revoke all on public.sos_email_subscriptions from public, anon, authenticated;
grant select (id, user_id, email, timezone, send_hour, status, next_day, next_send_at, created_at, updated_at)
  on public.sos_email_subscriptions to authenticated;
grant insert (user_id, email, timezone, send_hour) on public.sos_email_subscriptions to authenticated;
grant update (status, timezone, send_hour) on public.sos_email_subscriptions to authenticated;
grant all on public.sos_email_subscriptions to service_role;

create table if not exists public.sos_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.sos_email_subscriptions(id) on delete cascade,
  day_no integer not null check (day_no between 1 and 365),
  status text not null default 'processing' check (status in ('processing','sent','failed')),
  attempts integer not null default 1,
  lease_until timestamptz not null default (now() + interval '5 minutes'),
  provider_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, day_no)
);
create index if not exists sos_email_deliveries_status_idx on public.sos_email_deliveries(status, sent_at);
alter table public.sos_email_deliveries enable row level security;
revoke all on public.sos_email_deliveries from public, anon, authenticated;
grant all on public.sos_email_deliveries to service_role;

create table if not exists public.sos_email_runtime (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  cron_secret text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  daily_limit integer not null default 90 check (daily_limit between 1 and 10000),
  max_per_run integer not null default 12 check (max_per_run between 1 and 100),
  updated_at timestamptz not null default now()
);
insert into public.sos_email_runtime (singleton,enabled) values (true,false)
  on conflict (singleton) do nothing;
alter table public.sos_email_runtime enable row level security;
revoke all on public.sos_email_runtime from public, anon, authenticated;
grant select, update on public.sos_email_runtime to service_role;

-- Only the service role can claim delivery work. Concurrency uses row-level locks,
-- a lease, and Resend's fixed idempotency key per subscriber and reading day.
create or replace function public.sos_claim_due(p_limit integer default 12)
returns table (delivery_id uuid, sub_id uuid, recipient text, day_no integer, tz text, unsubscribe_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sub public.sos_email_subscriptions%rowtype;
  claimed_id uuid;
  allowed integer;
  sent_today integer;
begin
  select least(max_per_run, greatest(0, p_limit)), daily_limit
    into allowed, sent_today from public.sos_email_runtime where singleton = true and enabled = true;
  if allowed is null or allowed = 0 then return; end if;
  select count(*) into sent_today from public.sos_email_deliveries
    where status = 'sent' and sent_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  allowed := least(allowed, greatest(0,(select daily_limit from public.sos_email_runtime where singleton) - sent_today));
  if allowed <= 0 then return; end if;
  for sub in
    select s.* from public.sos_email_subscriptions s
    where s.status='active' and s.next_day <=365 and s.next_send_at <= now()
      and not exists (
        select 1 from public.sos_email_deliveries d
        where d.subscription_id=s.id and d.day_no=s.next_day
          and (d.status='sent' or d.attempts>=5 or d.lease_until > now())
      )
    order by s.next_send_at, s.id
    limit allowed
    for update skip locked
  loop
    claimed_id := null;
    insert into public.sos_email_deliveries as d (subscription_id,day_no,status,attempts,lease_until,error,updated_at)
      values (sub.id,sub.next_day,'processing',1,now()+interval '5 minutes',null,now())
    on conflict (subscription_id,day_no) do update
      set status='processing', attempts=d.attempts+1, lease_until=now()+interval '5 minutes',
          error=null,updated_at=now()
      where d.status <> 'sent' and d.attempts < 5 and d.lease_until <= now()
    returning id into claimed_id;
    if claimed_id is not null then
      delivery_id := claimed_id;
      sub_id := sub.id;
      recipient := sub.email;
      day_no := sub.next_day;
      tz := sub.timezone;
      unsubscribe_id := sub.unsubscribe_token;
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.sos_claim_due(integer) from public, anon, authenticated;
grant execute on function public.sos_claim_due(integer) to service_role;

create or replace function public.sos_mark_sent(p_id uuid,p_provider_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.sos_email_deliveries%rowtype;
  s public.sos_email_subscriptions%rowtype;
begin
  select * into d from public.sos_email_deliveries where id=p_id for update;
  if not found or d.status = 'sent' then return; end if;
  select * into s from public.sos_email_subscriptions where id=d.subscription_id for update;
  if not found or s.next_day <> d.day_no then return; end if;
  update public.sos_email_deliveries set status='sent',provider_id=p_provider_id,sent_at=now(),updated_at=now()
    where id=p_id;
  update public.sos_email_subscriptions set
    next_day = least(366,next_day+1),
    next_send_at = (((now() at time zone s.timezone)::date+1) + make_time(s.send_hour,0,0)) at time zone s.timezone,
    last_sent_at=now(),
    status=case when next_day>=365 then 'completed' else status end,
    updated_at=now()
    where id=s.id;
end $$;
revoke all on function public.sos_mark_sent(uuid,text) from public,anon,authenticated;
grant execute on function public.sos_mark_sent(uuid,text) to service_role;

create or replace function public.sos_mark_failed(p_id uuid,p_error text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.sos_email_deliveries
    set status='failed', lease_until=now()+interval '10 minutes',
        error=left(p_error,500), updated_at=now()
    where id=p_id and status <> 'sent';
end $$;
revoke all on function public.sos_mark_failed(uuid,text) from public,anon,authenticated;
grant execute on function public.sos_mark_failed(uuid,text) to service_role;

comment on table public.sos_email_runtime is 'Keep enabled=false until sender credentials, scheduler and test delivery have been verified.';
