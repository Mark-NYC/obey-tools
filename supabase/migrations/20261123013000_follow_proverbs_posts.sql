-- Proverbs conversations are independent from the Gospel SOS reading-day posts.
-- Existing Follow Circle memberships are reused. No existing posts or schedules change.
create table if not exists public.follow_proverbs_posts (
 id uuid primary key default gen_random_uuid(),
 circle_id uuid not null,
 author_id uuid not null references auth.users(id) on delete cascade,
 chapter integer not null check (chapter between 1 and 31),
 body text not null check (char_length(trim(body)) between 1 and 3000),
 parent_id uuid references public.follow_proverbs_posts(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index if not exists follow_proverbs_posts_circle_chapter_idx on public.follow_proverbs_posts(circle_id,chapter,created_at desc);
alter table public.follow_proverbs_posts enable row level security;
revoke all on public.follow_proverbs_posts from anon;
grant select,insert on public.follow_proverbs_posts to authenticated;
drop policy if exists "Circle members read Proverbs posts" on public.follow_proverbs_posts;
create policy "Circle members read Proverbs posts" on public.follow_proverbs_posts
 for select to authenticated using (
 exists (select 1 from public.follow_circle_members m where m.circle_id=follow_proverbs_posts.circle_id and m.user_id=auth.uid())
 );
drop policy if exists "Circle members write their Proverbs posts" on public.follow_proverbs_posts;
create policy "Circle members write their Proverbs posts" on public.follow_proverbs_posts
 for insert to authenticated with check (
 author_id=auth.uid()
 and exists (select 1 from public.follow_circle_members m where m.circle_id=follow_proverbs_posts.circle_id and m.user_id=auth.uid())
 );

-- Reactions are scoped to Proverbs and remain invisible to Gospel SOS.
create table if not exists public.follow_proverbs_reactions (
 post_id uuid not null references public.follow_proverbs_posts(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (post_id,user_id)
);
alter table public.follow_proverbs_reactions enable row level security;
revoke all on public.follow_proverbs_reactions from anon;
grant select,insert,delete on public.follow_proverbs_reactions to authenticated;
drop policy if exists "Members read Proverbs reactions" on public.follow_proverbs_reactions;
create policy "Members read Proverbs reactions" on public.follow_proverbs_reactions for select to authenticated
 using (exists (
  select 1 from public.follow_proverbs_posts p
  join public.follow_circle_members m on m.circle_id=p.circle_id
  where p.id=follow_proverbs_reactions.post_id and m.user_id=auth.uid()
 ));
drop policy if exists "Members react to Proverbs posts" on public.follow_proverbs_reactions;
create policy "Members react to Proverbs posts" on public.follow_proverbs_reactions for insert to authenticated
 with check (user_id=auth.uid() and exists (
  select 1 from public.follow_proverbs_posts p
  join public.follow_circle_members m on m.circle_id=p.circle_id
  where p.id=follow_proverbs_reactions.post_id and m.user_id=auth.uid()
 ));
drop policy if exists "Members remove own Proverbs reactions" on public.follow_proverbs_reactions;
create policy "Members remove own Proverbs reactions" on public.follow_proverbs_reactions for delete to authenticated
 using (user_id=auth.uid());
