# Translation admin — Phase 0 (foundation)

Schema, authorization, importer, and the round-trip proof for the Supabase-backed
translation admin. **Phase 0 makes no runtime changes** — no HTML page imports any
of this, and the live site keeps serving static `/lang/*.json`. English remains
canonical in `/lang/en.json`.

## What's here

| File | Purpose |
|---|---|
| `01_schema.sql` | The 5 tables + `profiles.is_translation_admin`; RLS on, deny-by-default |
| `02_authz.sql` | Helpers, RLS policies, public read views, SECURITY DEFINER write RPCs |
| `03_languages.sql` | Seeds the 10 existing languages (from the current selector) |
| `import.mjs` | Offline importer/validator → `report.*` and `seed/*.sql` |
| `seed/01_keys.sql` | 766 English keys (generated) |
| `seed/02_values_<lang>.sql` | Per-language values (generated) |
| `04_authorization_tests.sql` | RLS/authorization proofs (runs in a rollback) |
| `99_rollback.sql` | Full teardown |
| `report.md` / `report.json` | Import audit incl. Tibetan orphan quarantine |

The pure catalog logic lives in `../../tools/i18n/catalog.mjs` and is exercised by
`../../tests/translations/run.mjs`.

## Run order

```sh
# 1. Regenerate the audit + seed SQL from /lang/*.json (offline, no DB writes)
node supabase/translations-migration/import.mjs

# 2. Prove the logic (round-trip, atomic arrays, derived state, HTML, orphans)
node tests/translations/run.mjs

# 3. Apply to Supabase (SQL editor), in order:
#    01_schema.sql → 02_authz.sql → 03_languages.sql
#    → seed/01_keys.sql → seed/02_values_*.sql
# 4. Prove authorization:
#    04_authorization_tests.sql   (self-rolls-back)
```

## Key decisions baked in

- **English is the structural skeleton.** Structure is never inferred from key
  paths, so object-vs-array containers (`steps` keyed `"1".."8"` vs the `flow`
  array) can't be corrupted. Verified: all 10 files round-trip byte-identical.
- **Arrays publish atomically.** Because the app's `_merge` replaces arrays
  wholesale, a `flow` array is published only when every cell is publishable;
  otherwise it's omitted and English shows. Proven in the test suite.
- **Every `flow` cell is translatable content** — the `[0]` cells hold real
  words (`"Follow"`, `"Fish"`) as well as numbers, so none are treated as
  structural constants.
- **Workflow vs derived state are separate.** `workflow_status ∈
  {draft,needs_review,approved}`; missing/outdated/publishable are derived.
- **Approval and publish are admin-only.** Translators edit assigned languages
  and submit for review; they cannot approve or publish. All writes go through
  SECURITY DEFINER RPCs (no direct table writes).
- **Tibetan orphans quarantined.** The 12 `bo.json` keys not in English
  (`settings.*` ×8, `section_keys.*` ×3, `mawl.subtitle`) are reported and never
  imported, promoted, or published.

## Two items need a human decision (see report.md)

1. **`bo.four_questions.subtitle`** uses four `<span class="green">` wrappers
   where English has one. Strict markup-lock (the binding rule) blocks it, so it
   imports as `needs_review`. Decide: keep strict structural-equality, or relax
   to an allowlist that permits repeating an already-approved tag/class.
2. **HTML validation depth.** Signature comparison (regex) covers today's 4 HTML
   keys. If future keys use richer markup, a parser (Edge Function) may be needed.
