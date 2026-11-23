-- Proverbs conversations are independent from the Gospel SOS reading-day posts.
-- Existing Follow Circle memberships are reused. No existing posts or schedules change.
create table if not exists public.follow_proverbs_posts (
 id uuid primary key default gen_random_uuid(),
 circle_id uuid not null,
 author_id uuid not null references auth.users(id) on delete cascade,
 chapter integer not null check (chapter between 1 and 31),
 body text not null check (char_length(trim(body)) between 1 and 3000),
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
