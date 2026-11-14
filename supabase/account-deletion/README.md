# Account deletion (draft — not applied)

Apple requires apps that support account creation to let people delete their
account **from inside the app** (App Store Review Guideline 5.1.1(v)). The iOS
app's Settings screen calls `supabase.rpc('delete_my_account')`. Until this SQL
is applied, the app tells the user deletion isn't enabled and changes nothing.

**This is a production database change. It has not been run.**

## Decide before applying

1. **Shared data a user created** (`networks`, `mawl_checklists`, checklist
   sections/items, `leader_invites` via `created_by` / `invited_by`). The draft
   leaves these in place so collaborators don't lose data. If any of those
   columns reference `auth.users` *without* `on delete set null`/`cascade`,
   deleting the auth user will fail and roll back. Options: set them to null,
   transfer ownership, or delete them. Check with:

   ```sql
   select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
   from pg_constraint
   where confrelid = 'auth.users'::regclass;
   ```

2. **Table list.** `personal_tables` was built from the site's client queries
   (`.eq('user_id', …)`). Confirm each table really is per-user and nothing is
   missing (`list tables` in the Supabase dashboard).

3. **Map/progress data** (`submitted_events`, `submitted_green_lights`) feeds
   public aggregate counts. Deleting removes the person's contributions from
   the map. If you'd rather keep anonymous counts, null out `user_id` instead.

## Apply (after review)

Run `01_delete_my_account.sql` in the Supabase SQL editor, then test with a
throwaway account: sign up in the app → Settings → Delete account → confirm the
user is gone from Authentication → Users and their rows are gone.
