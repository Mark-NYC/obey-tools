# Account deletion: production status (2026-11-19)

Production Supabase project: `mjiswwujcsmayuytoaul` (OBEY.TOOLS).

## Deployed in Supabase

- `public.delete_my_account()`: existing self-only deletion for an account with no blocking shared resources.
- `public.account_deletion_impact()`: authenticated, read-only preview of owned networks, additional owned MAWL checklists, and attributed progress outside those resources.
- `public.delete_my_account_with_owned_content('DELETE SHARED DATA')`: self-only, explicit destructive option. Deletes owned networks and related shared checklists/content, separately owned checklists, and progress attributed to the caller, then invokes `delete_my_account()` in the same transaction.
- No deletion performed by migration. 128 auth accounts before and after it.
- `anon` has no EXECUTE on these functions. `authenticated` has EXECUTE. Confirmed anonymous denial.

## iOS interface (this pull request, not yet released)

- Settings → Delete account fetches the impact preview; disables deletion if unavailable.
- No shared ownership: original simple deletion with confirmation.
- Shared ownership: explains exact counts and that other users' shared data may be removed; requires an explicit checkbox before enabling Delete.
- On success, removes cloud account, signs out, detaches sync bookkeeping; offline device data is retained.
- On failure, displays the error without reporting success.

## Important remaining checks before App Store submission

1. Merge this PR and upload a **new signed App Store build**; an already-uploaded binary will not contain the iOS change.
2. Validate both paths with newly created disposable accounts, including one with a disposable network and checklist; do not test with existing user accounts.
3. Test on a physical iPhone: confirmation, no-network error handling, native settings presentation, sign-out and offline preservation.
4. Review all non-FK personal-data references and intended retention of shared records.
5. Obtain sign-off on the explicit choice to destroy shared resource data instead of transferring ownership.

The earlier `01_delete_my_account.sql` is a superseded draft. Do not apply it.
