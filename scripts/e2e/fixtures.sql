-- Ephemeral E2E database only: the other tables Conversation Box sync touches,
-- shaped as conversation-box.html uses them, each owner-only under RLS.
create table public.profiles(id uuid primary key references auth.users(id));
create table public.submitted_events(user_id uuid not null references auth.users(id), person_name text not null, event_type text not null);
create table public.submitted_green_lights(user_id uuid not null references auth.users(id), person_name text not null);
create table public.conversation_events(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), event_type text, latitude double precision, longitude double precision, location_text text, city text, country_code text, region text, place_key text, place_label text, count integer);
do $$
declare t text;
begin
 foreach t in array array['submitted_events','submitted_green_lights','conversation_events'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy own on public.%I for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid())', t);
  execute format('grant select,insert,update,delete on public.%I to authenticated', t);
 end loop;
end$$;
alter table public.profiles enable row level security;
create policy own on public.profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
grant select,insert,update on public.profiles to authenticated;
