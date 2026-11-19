# Account deletion: production status (2026-11-18)

The production Supabase project is `mjiswwujcsmayuytoaul` (Obey Tools).

## Deployed
- Migration `safe_self_service_account_deletion` installed `public.delete_my_account()`.
- The native Settings page already invokes `supabase.rpc('delete_my_account')`.
- `authenticated` has EXECUTE; `anon` does not.
- A SQL test of an unauthenticated call returned the expected denial, without modifying user records.
- The function preserves shared resources by refusing deletion while the caller owns a network, MAWL checklist, or MAWL progress row.
- It detaches optional user references from shared records, deletes the caller's invites, then deletes their auth user. Database cascades remove directly linked private rows.

## Not yet verified
- A real authenticated disposable-account end-to-end deletion.
- The ownership-blocked path with a disposable network/checklist.
- Local iPhone data preservation after deletion.
- Every user-linked table and non-FK reference has been reviewed for privacy/retention.
- A self-service ownership transfer path. Currently the error directs owners to support.

Do **not** claim App Store readiness or successful end-to-end deletion until these are tested. Do not use an existing person's account as a test fixture.

The older `01_delete_my_account.sql` is a superseded draft; do not apply it over the deployed function.
