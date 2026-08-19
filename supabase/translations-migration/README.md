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

## Locked decisions (v1)

1. **Strict structural equality for HTML.** No allowlist for repeated
   tags/classes. `bo.four_questions.subtitle` (four `<span class="green">` vs
   one) stays `needs_review` until its markup is normalized to the English
   structure — the Tibetan content gets fixed, the invariant does not weaken.
2. **Signature-based HTML validation is the v1 boundary.** v1 supports the
   current constrained HTML vocabulary and requires structural signature
   equality (tag names, attributes, classes, nesting, and placeholders must
   match English exactly; only text nodes may change). This is sufficient for
   the 4 HTML keys we have today. **If richer or nested markup is introduced
   later, move to parser-based structural comparison _before_ allowing that
   markup to publish.** The parser is intentionally NOT built now.

---

# Phase 1 — private admin dashboard & editor

Adds the internal translation-management tool. **Still no runtime changes**: the
public site keeps serving static `/lang/*.json`; nothing is published.

| File | Purpose |
|---|---|
| `05_phase1_admin.sql` | `translation_language_stats` view (RLS-scoped) + admin RPCs `assign_translator_by_email`, `list_translation_access` |
| `06_phase1_authz_tests.sql` | Phase 1 authorization proofs (self-rolls-back) |
| `../../translations-admin.html` | The admin page (self-gating; not linked from public nav) |
| `../../translations-admin.js` | Dashboard + editor logic; reads RLS-scoped, mutates only via Phase 0 RPCs |
| `../../tools/i18n/status.mjs` | Shared pure derived-state/validation (editor + tests) |
| `../../tests/translations/phase1.mjs` | Phase 1 logic proofs |

Reach the tool at `/translations-admin.html`. Access requires either
`profiles.is_translation_admin = true` (admin) or a `translator_language_access`
row (translator). The `leader` role grants nothing here.

Apply order (after Phase 0): `05_phase1_admin.sql`, then verify with
`06_phase1_authz_tests.sql`.

## What the tool does

- **Dashboard:** per-language translated %/approved %, missing, outdated,
  needs-review, published version; a quarantined-orphan banner.
- **Editor:** English source read-only beside an editable translation; key path,
  area/namespace context; search; area filter; All/Missing/Draft/Needs
  review/Approved/Outdated/Invalid filters; live completion + approved progress;
  per-key badges (missing/draft/needs-review/approved, plus outdated / invalid /
  "will publish"); inline validation reasons.
- **Atomic arrays** render as one bordered unit with an all-or-English banner:
  if any cell is missing/unapproved/outdated/invalid, the banner states the
  whole group falls back to English. Every flow cell is treated as translatable.
- **Workflow:** Save draft → Submit for review → (admin) Approve/Reject, all via
  the Phase 0 RPCs.
- **Admin:** assign/revoke translators by email; orphan diagnostics (read-only,
  cannot enter the workflow).
