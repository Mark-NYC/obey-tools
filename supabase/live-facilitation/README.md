# Live Group Facilitation — migration runbook (TEST FEATURE)

Backend for the **unlinked test pages**:

- `hope-for-the-rejected-live-test.html` — the duplicated Stories of Hope page
  with live facilitation (facilitator **and** participant view).
- `live-join-test.html` — enter a 4-character code to join.

Nothing here runs automatically. Apply it yourself, once, by pasting the SQL
into the Supabase SQL editor. **The test pages fail gracefully if this has not
been applied** — the guide still works as a static facilitated guide; only the
"Facilitate with a group" / join flow shows a friendly "not available yet"
message.

## What it creates

| Object | Purpose | Access |
|---|---|---|
| `live_sessions` | one row per live session: `join_code`, `story_id`, `current_step`, `status`, `created_at`, `expires_at`, `ended_at` | **public SELECT** (no secrets); realtime; no direct writes |
| `live_session_hosts` | `host_token_hash` (SHA-256) + `facilitator_id` | **no client access** (RLS denies all); RPC-only |
| `live_session_reports` | `people_present`, `people_set_goal`, `story_id`, `facilitator_id`, `created_at` | owner-only SELECT; RPC-only insert; never public |
| `live_create_session` / `live_set_step` / `live_end_session` / `live_get_by_code` | the only mutation/lookup surface | `SECURITY DEFINER`, host token verified server-side |

Security posture mirrors the `/band` Option B migration:

- The facilitator's **host token is never stored in plaintext and never sent to
  participants** — only its SHA-256 hash is stored, in a table with no client
  policies. Every facilitator action (`live_set_step`, `live_end_session`)
  re-verifies the token inside a `SECURITY DEFINER` RPC.
- Anonymous participants get **read-only** access to the one followable row
  (which contains nothing sensitive) plus its realtime stream. They cannot
  change the highlight and cannot read reports.
- Reports are readable only by the authenticated facilitator who owns them
  (`facilitator_id = auth.uid()`), which is what a future leader dashboard will
  build on. No anon read.
- Join codes are unique **only among active sessions** (partial unique index)
  and every session `expires_at = created + 6 hours`; the RPCs refuse expired or
  ended sessions.

## Apply (one paste)

1. Open the Supabase project → **SQL editor** → **New query**.
2. Paste the entire contents of [`01_schema.sql`](./01_schema.sql) and **Run**.
   It is idempotent — safe to re-run.
3. Confirm `pgcrypto` is enabled (the script does
   `create extension if not exists pgcrypto with schema extensions;`). If your
   project puts extensions in a different schema, adjust the `extensions.digest`
   reference in `live_hash_token` accordingly.
4. (Optional) Verify:

   ```sql
   select proname from pg_proc where proname like 'live\_%';
   select tablename from pg_tables where tablename like 'live\_%';
   select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'live_sessions';
   ```

No app redeploy is required — the test pages call these RPCs directly through
the existing anon key.

## Rollback

```sql
drop function if exists public.live_create_session(text, text);
drop function if exists public.live_set_step(uuid, text, integer);
drop function if exists public.live_end_session(uuid, text, integer, integer);
drop function if exists public.live_get_by_code(text);
drop function if exists public.live_gen_code();
drop function if exists public.live_hash_token(text);

do $$ begin
  begin alter publication supabase_realtime drop table public.live_sessions;
  exception when others then null; end;
end $$;

drop table if exists public.live_session_reports;
drop table if exists public.live_session_hosts;
drop table if exists public.live_sessions;
```

Because these objects are entirely new and isolated (nothing else references
them), rollback cannot affect any existing table, page, or behavior.
