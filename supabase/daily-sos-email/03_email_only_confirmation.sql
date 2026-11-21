-- Follow Daily email-only confirmation, no Supabase account required.
-- Existing account-linked subscriptions remain intact.
alter table public.sos_email_subscriptions alter column user_id drop not null;

create table if not exists public.sos_email_pending (
  email text primary key,
  timezone text not null,
  send_hour integer not null check(send_hour between 0 and 23),
  confirmation_token uuid not null unique default gen_random_uuid(),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  attempts integer not null default 1 check(attempts between 1 and 20)
);
alter table public.sos_email_pending enable row level security;
revoke all on public.sos_email_pending from public,anon,authenticated;
grant all on public.sos_email_pending to service_role;

create table if not exists public.sos_email_signup_rate (
  fingerprint text primary key,
  window_start timestamptz not null default now(),
  request_count integer not null default 0
);
alter table public.sos_email_signup_rate enable row level security;
revoke all on public.sos_email_signup_rate from public,anon,authenticated;
grant all on public.sos_email_signup_rate to service_role;

-- Atomic throttling for both email and requester fingerprint, accessible only via service role.
create or replace function public.sos_signup_throttle(p_fingerprint text,p_limit integer,p_interval interval)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
  insert into public.sos_email_signup_rate as t (fingerprint,window_start,request_count)
  values (p_fingerprint,now(),1)
  on conflict(fingerprint) do update
  set window_start=case when t.window_start < now()-p_interval then now() else t.window_start end,
      request_count=case when t.window_start < now()-p_interval then 1 else t.request_count+1 end
  returning request_count into n;
  return n <= p_limit;
end $$;
revoke all on function public.sos_signup_throttle(text,integer,interval) from public,anon,authenticated;
grant execute on function public.sos_signup_throttle(text,integer,interval) to service_role;
