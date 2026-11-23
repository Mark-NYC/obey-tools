-- Navigators plan data is independent of Gospel SOS and Proverbs.
-- Run only after reviewing the production backup and existing Follow Circle membership schema.
create table if not exists public.navigators_reading_progress (
 user_id uuid not null references auth.users(id) on delete cascade,
 reading_day integer not null check (reading_day between 1 and 301), -- 301 holds last-viewed cursor
 payload jsonb not null default '{}'::jsonb,
 revision_ms bigint not null default 0,
 primary key (user_id,reading_day)
);
alter table public.navigators_reading_progress enable row level security;
revoke all on public.navigators_reading_progress from anon;
grant select,insert,update on public.navigators_reading_progress to authenticated;
drop policy if exists "Navigators owner may read" on public.navigators_reading_progress;
create policy "Navigators owner may read" on public.navigators_reading_progress
 for select to authenticated using (user_id=auth.uid());
drop policy if exists "Navigators owner may insert" on public.navigators_reading_progress;
create policy "Navigators owner may insert" on public.navigators_reading_progress
 for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "Navigators owner may update" on public.navigators_reading_progress;
create policy "Navigators owner may update" on public.navigators_reading_progress
 for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create table if not exists public.navigators_circle_posts (
 id uuid primary key default gen_random_uuid(),
 circle_id uuid not null,
 author_id uuid not null references auth.users(id) on delete cascade,
 reading_day integer not null check (reading_day between 1 and 300),
 parent_id uuid references public.navigators_circle_posts(id) on delete cascade,
 body text not null check (char_length(trim(body)) between 1 and 3000),
 created_at timestamptz not null default now()
);
create index if not exists navigators_circle_posts_lookup on public.navigators_circle_posts(circle_id,reading_day,created_at desc);
alter table public.navigators_circle_posts enable row level security;
revoke all on public.navigators_circle_posts from anon;
grant select,insert on public.navigators_circle_posts to authenticated;
drop policy if exists "Navigators Circle members read" on public.navigators_circle_posts;
create policy "Navigators Circle members read" on public.navigators_circle_posts
 for select to authenticated using (
  exists(select 1 from public.follow_circle_members m where m.circle_id=navigators_circle_posts.circle_id and m.user_id=auth.uid())
 );
drop policy if exists "Navigators Circle members share" on public.navigators_circle_posts;
create policy "Navigators Circle members share" on public.navigators_circle_posts
 for insert to authenticated with check (
  author_id=auth.uid()
  and exists(select 1 from public.follow_circle_members m where m.circle_id=navigators_circle_posts.circle_id and m.user_id=auth.uid())
  and (parent_id is null or exists(
   select 1 from public.navigators_circle_posts p
   where p.id=parent_id and p.circle_id=navigators_circle_posts.circle_id and p.reading_day=navigators_circle_posts.reading_day))
 );

-- Reactions stay within Navigators posts and respect the existing Circle membership.
create table if not exists public.navigators_circle_reactions (
 post_id uuid not null references public.navigators_circle_posts(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (post_id,user_id)
);
alter table public.navigators_circle_reactions enable row level security;
revoke all on public.navigators_circle_reactions from anon;
grant select,insert,delete on public.navigators_circle_reactions to authenticated;
drop policy if exists "Navigators members see reactions" on public.navigators_circle_reactions;
create policy "Navigators members see reactions" on public.navigators_circle_reactions for select to authenticated using (
 exists (select 1 from public.navigators_circle_posts p join public.follow_circle_members m on m.circle_id=p.circle_id
 where p.id=navigators_circle_reactions.post_id and m.user_id=auth.uid())
);
drop policy if exists "Navigators members react" on public.navigators_circle_reactions;
create policy "Navigators members react" on public.navigators_circle_reactions for insert to authenticated with check (
 user_id=auth.uid() and exists (select 1 from public.navigators_circle_posts p join public.follow_circle_members m on m.circle_id=p.circle_id
 where p.id=navigators_circle_reactions.post_id and m.user_id=auth.uid())
);
drop policy if exists "Navigators members remove own reactions" on public.navigators_circle_reactions;
create policy "Navigators members remove own reactions" on public.navigators_circle_reactions for delete to authenticated using (user_id=auth.uid());
