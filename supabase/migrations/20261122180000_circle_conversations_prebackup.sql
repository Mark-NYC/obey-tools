-- OBEY.TOOLS release recovery snapshot for Conversation Box × Circles.
-- Restricted to circles_private, not exposed through the public Data API.
-- Database-local recovery point only, not a disaster-recovery/off-site backup.
-- No existing data is changed.

create table circles_private.release_20261122_follow_circles as select * from public.follow_circles;
revoke all on circles_private.release_20261122_follow_circles from public,anon,authenticated;

create table circles_private.release_20261122_follow_circle_members as select * from public.follow_circle_members;
revoke all on circles_private.release_20261122_follow_circle_members from public,anon,authenticated;

create table circles_private.release_20261122_follow_circle_posts as select * from public.follow_circle_posts;
revoke all on circles_private.release_20261122_follow_circle_posts from public,anon,authenticated;

create table circles_private.release_20261122_conversation_people as select * from public.conversation_people;
revoke all on circles_private.release_20261122_conversation_people from public,anon,authenticated;

create table circles_private.release_20261122_sos_daily_progress as select * from public.sos_daily_progress;
revoke all on circles_private.release_20261122_sos_daily_progress from public,anon,authenticated;

-- Fail the snapshot migration if any table was not copied in full.
do $$
begin
 if (select count(*) from circles_private.release_20261122_follow_circles)<>(select count(*) from public.follow_circles)
 then raise exception 'Backup row count mismatch: follow_circles';end if;
 if (select count(*) from circles_private.release_20261122_follow_circle_members)<>(select count(*) from public.follow_circle_members)
 then raise exception 'Backup row count mismatch: follow_circle_members';end if;
 if (select count(*) from circles_private.release_20261122_follow_circle_posts)<>(select count(*) from public.follow_circle_posts)
 then raise exception 'Backup row count mismatch: follow_circle_posts';end if;
 if (select count(*) from circles_private.release_20261122_conversation_people)<>(select count(*) from public.conversation_people)
 then raise exception 'Backup row count mismatch: conversation_people';end if;
 if (select count(*) from circles_private.release_20261122_sos_daily_progress)<>(select count(*) from public.sos_daily_progress)
 then raise exception 'Backup row count mismatch: sos_daily_progress';end if;
end;$$;
