# /band Option B migration — plan and runbook

Rework of the Band dashboard's persistence from a single JSON blob
(`band_data`, id `'main'`) to a normalized per-city schema, per the July 2026
reliability assessment. The UI and workflow do not change.

**Status: awaiting approval. Nothing here has been run against production.**

## Target schema

| Table | Purpose | Key properties |
|---|---|---|
| `band_cities` | one row per city (counters, stream depth) | writes to one city can never touch another; counters `>= 0` enforced |
| `band_leaders` | one row per leader | FK to city, cascade delete; unique per city |
| `band_posts` | posting status per **leader + city + meeting period** | PK `(leader_id, meeting_key)`; un-mark writes `posted=false` (auditable, realtime-friendly) |

Atomic RPCs (SECURITY INVOKER, so RLS applies): `band_adjust_counter`
(clamped at 0; simultaneous +1s both count), `band_step_stream_depth`,
`band_set_post`. The Churches counter mirrors `churches_ytd` into
`total_churches` exactly as the current UI does.

**Meeting keys are normalized during migration** (approved 2026-07-18): the
legacy `'<year>-<jsMonthIndex>-<2|4>'` format (0-indexed month; `'2026-6-4'`
= 4th Sunday of *July*) is converted to the ISO date of the meeting Sunday
(`'2026-07-26'`) for all historical and future records, via
`band_legacy_key_to_date()` using the page's exact nth-Sunday arithmetic.
Unconvertible keys abort the migration (history is never silently dropped);
`04_validate.sql` sections 4.K1–4.K4 prove conversion completeness,
no drops/duplicates, and correct meeting dates; `99_rollback.sql` converts
keys back to the legacy format (`band_date_to_legacy_key()`) and reports a
restored-vs-backup diff (section 99.1b).

## Run order (each file is a single paste into the Supabase SQL editor)

| Step | File | Effect | Reversible? |
|---|---|---|---|
| 0 | `00_verify_current_config.sql` | read-only diagnostics: realtime publication contents, `band_data` columns, RLS/policies/grants, data summary | n/a |
| 1 | `01_backup.sql` | snapshot table `band_data_backup_20260718` + JSON export to save locally | n/a (is the safety net) |
| 2 | `02_schema.sql` | new tables, RPCs, RLS (interim public policies = today's access model), realtime publication | yes — `99_rollback.sql` |
| 3 | `03_data_migration.sql` | copies blob → new tables via re-runnable `band_migrate_from_blob()`; `band_data` untouched | yes — re-runnable, wipe-and-refill |
| 4 | `04_validate.sql` | read-only comparison of blob vs new tables (counts, per-city metrics, per-leader posts) | n/a |
| — | *(deploy reworked band.html — separate approval)* | | old page redeployable at any time |
| 90 | `90_security_upgrade.sql` | leader-gated RLS via existing `profiles.role='leader'` (**do not run until security approach approved**) | yes — policies can be swapped back |
| 99 | `99_rollback.sql` | exports new-table edits back into the blob, drops all new objects | — |

## Cutover plan

1. Run steps 0–4 at any time; the old page keeps working unmodified (it only
   touches `band_data`).
2. When the reworked `band.html` is approved and ready: re-run step 3 (it
   wipes and refills the new tables, capturing any edits made through the old
   page since the first run), re-run step 4, then deploy the new page. Total
   window: a couple of minutes; do it outside a meeting.
3. Run step 90 once the security approach is approved (before or after
   cutover — the new page works under either policy set).
4. Rollback at any point: redeploy old `band.html` (git revert), run
   `99_rollback.sql`. The blob is never modified by the migration, so
   pre-cutover rollback is just the redeploy.

## Security model (proposed, awaiting approval)

Reuses the site's existing auth: leaders already have accounts and
`profiles.role = 'leader'` already gates other leader pages via
`initLeaderPage()` in `auth.js`. The band page adds the same gate; leaders
sign in once per device and the session persists (localStorage, shared
across obey.tools pages). RLS restricts all band tables to leader profiles;
`90_security_upgrade.sql` has a commented `[PUBLIC-READ]` variant if the
dashboard should stay viewable without sign-in. The hardcoded settings
password stops being a security boundary (RLS is), though the prompt can be
kept as UX friction.

## Open items to verify with step 0 output

- Is `band_data` in the `supabase_realtime` publication? (If not, legacy
  Live mode never received events — worth knowing for the postmortem.)
- Does the `modified_by` column exist, and what type is `last_modified`?
- What policies/grants currently exist on `band_data` (assessed as
  anon-writable; confirm)?
- Roughly how many `profiles` rows have `role='leader'` (everyone who needs
  band access must end up a leader before step 90).
