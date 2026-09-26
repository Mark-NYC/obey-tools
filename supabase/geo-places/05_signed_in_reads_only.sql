-- ============================================================================
-- Worldwide places - only signed-in users can read conversation events
--
-- The existing SELECT policy applies to role `public`, which includes `anon`.
-- The anon key ships in supabase.js, so anyone could read every
-- non-network event (user_id, coordinates, place, timestamps) without an
-- account; the map's sign-in wall was UI only. Every page that reads this
-- table already requires sign-in (view-progress, how-were-doing,
-- conversation-box), so nothing breaks.
--
-- Idempotent, safe to re-run. Revert: same statement with `to public`.
-- ============================================================================

alter policy "members can read conversation events"
  on public.conversation_events
  to authenticated;
