# Urdu integration checks

Requires Node.js, `playwright-core`, and an installed Chromium browser. The test starts its own static server on port 8098 and mocks Supabase and external requests, so it does not write production data.

```sh
NODE_PATH=/path/to/node_modules CHROMIUM_PATH=/path/to/chromium node tests/i18n/run.cjs
```

Screenshots go to `/tmp/obey-urdu-shots` (override with `I18N_SHOTS`). Set `I18N_AUDIT=1` to list remaining visible Latin text for review. Brands, personal names, Bible edition abbreviations, and international language labels intentionally remain unchanged.

See `docs/urdu-review.md` for the native-speaker and real-device test checklist.
