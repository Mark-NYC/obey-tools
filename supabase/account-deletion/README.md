# Account deletion (draft, not applied)

Apple requires apps that let people create an account to also let them delete
it **from inside the app** (App Store Review Guideline 5.1.1(v)). The iOS app's
Settings screen calls `supabase.rpc('delete_my_account')`. Until this SQL is
applied, the app says deletion isn't enabled and changes nothing.

**This is a production database change. It has not been run.**

In the app, deleting the account removes the **cloud copy** only. People,
notes and progress saved on the iPhone are kept and detached from the deleted
account (offline-first promise; `app/tests/offline-first.mjs` B10 verifies it).

## Review against the repository schema (2026-11-14)

What the repo's SQL actually defines:

| Table | User link | On account deletion |
|---|---|---|
| `live_session_hosts`, `live_session_reports` | `facilitator_id → auth.users on delete set null` | Kept, anonymised automatically ✅ |
| `band_cities`, `band_leaders`, `band_posts` | none (leader names are text) | Untouched. Names typed into the band dashboard are not linked to accounts. |
| `geo_cache`, `geo_backfill_skipped` | none | Untouched |
| `conversation_events` | `user_id`, `network_id` (policy in `geo-places/07`) | Deleted by the draft; see decision 3 |

What the repo does **not** define: the core tables (`profiles`,
`conversation_people`, `submitted_events`, `submitted_green_lights`,
`command_progress`, `church_assessments`, `networks`, `network_members`,
`mawl_checklists`, `mawl_progress`, `checklist_*`, `leader_invites`). Their
columns were inferred from the site's queries (`user_id`, `created_by`,
`invited_by`). **Their foreign keys are unknown.** The draft therefore:

- deletes only `(table, column)` pairs that exist at run time
  (`information_schema` check), so a wrong guess skips instead of failing;
- runs in one transaction, so an unexpected foreign key rolls everything back
  and nothing is half-deleted.

Problems fixed since the first draft:
- `leader_invites.invited_by` was not handled. It is now deleted.
- `conversation_events` (map contributions) was listed without explanation. It is now called out as decision 3.
- There was no way to check before deleting. Added `account_deletion_preview()`, which is read-only.

## Decide before applying

1. **Shared things a person created**: `networks.created_by`,
   `mawl_checklists.created_by`. The draft leaves them so collaborators keep
   their data. If those columns reference `auth.users` without
   `on delete set null`/`cascade`, the final `delete from auth.users` fails
   and nothing is deleted. Options: set to null, transfer ownership, or delete.
2. **Leader invites** they issued are deleted. Pending invites stop working.
3. **Map contributions** (`conversation_events`) feed public aggregate counts.
   Deleting them lowers the map's totals. Alternative: null the `user_id`
   (anonymise) instead. Privacy-wise, deleting is the cleaner answer.

## Read-only checks to run first (safe)

```sql
-- Every foreign key that points at auth.users, and what it does on delete:
select conrelid::regclass as table_name, conname,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where confrelid = 'auth.users'::regclass;

-- Every public column that probably stores a user id:
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and column_name in ('user_id','created_by','invited_by','owner_id','leader_id','facilitator_id')
order by 1, 2;
```

Compare the results with the table lists in `01_delete_my_account.sql`, and add
anything missing.

## Apply (after review and approval)

1. Run `01_delete_my_account.sql` in the Supabase SQL editor (staging first if you have one).
2. Sign up a throwaway account in the app, add a few people, and sync.
3. `select * from public.account_deletion_preview();` as that user: the counts should match what you created.
4. In the app: Settings → Delete account. Check Authentication → Users and the
   tables above: the user and their rows are gone. On the phone, the people are
   still there.
