-- ============================================================================
-- STEP 5 — Identify which accounts need Band access before cutover (READ-ONLY)
--
-- profiles.role = 'leader' is a SITE-WIDE role shared by every leader-gated
-- page (leader-tools.html, etc.) — it is not Band-specific, and the 13 names
-- tracked inside band_data are free-text strings with no link to any user
-- account. So "does every intended Band editor already have leader access"
-- cannot be answered by a join; it requires a human match between this list
-- and the actual list of people who run city updates during Band meetings.
-- ============================================================================

-- 5.1 Everyone who will get Band access under 90_security_upgrade.sql today
--     (all 6 current leader profiles — Band does not get its own narrower
--     role; it reuses the site's existing leader gate).
select p.id, u.email, p.role
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'leader'
order by u.email;

-- 5.2 For comparison: the 13 names currently tracked inside the Band blob,
--     grouped by city (these are display names only — there's no reliable
--     way to match them to the emails above without asking).
select c->>'name' as city, jsonb_agg(l->>'name' order by l->>'name') as tracked_leader_names
from public.band_data, jsonb_array_elements(cities) c,
     jsonb_array_elements(coalesce(c->'leaders','[]'::jsonb)) l
where id = 'main'
group by c->>'name'
order by 1;

-- 5.3 Everyone who is NOT currently a leader, in case an intended editor is
--     missing entirely and needs role='leader' added before cutover.
select p.id, u.email, p.role
from public.profiles p
join auth.users u on u.id = p.id
where p.role <> 'leader'
order by u.email;

-- To grant Band (site-wide leader) access to an existing account once you've
-- confirmed who needs it:
-- update public.profiles set role = 'leader' where id = '<their auth.users.id>';
