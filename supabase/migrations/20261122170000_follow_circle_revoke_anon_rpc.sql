-- Supabase grants EXECUTE to anon by default for new public functions.
-- Remove those grants explicitly; only invitation previews are anonymously callable.
revoke execute on function
 public.follow_circle_create(text,text),
 public.follow_circle_join(text,text),
 public.follow_circle_new_invite(uuid),
 public.follow_circle_revoke_invites(uuid),
 public.follow_circle_leave(uuid),
 public.follow_circle_remove(uuid,uuid),
 public.follow_circle_transfer(uuid,uuid),
 public.follow_circle_progress(uuid,integer,integer)
from anon;
revoke all on schema circles_private from anon;
grant execute on function public.follow_circle_invite_preview(text) to anon;