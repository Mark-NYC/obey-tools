# /band dashboard reliability regression tests

These tests encode the **non-negotiable behavior** for the Band tracking
dashboard, agreed during the July 2026 reliability assessment:

- A leader edits their city and intentionally submits the update.
- The system clearly shows whether the save succeeded or failed.
- A successful update is persisted **before** success is displayed.
- Other users see new data automatically (or via an obvious refresh).
- No update fails silently.
- Losing internet never creates the impression an update was saved.
- Concurrent users cannot erase one another's unrelated changes.

## How they work

`run.js` drives the real, unmodified `band.html` in multiple simultaneous
Chromium sessions (Playwright). The backend is `mock-server.js`, a local
stand-in for the Supabase project with PostgREST-identical update semantics
(atomic conditional updates, a change feed for realtime). `supabase-stub.js`
is served in place of the CDN `@supabase/supabase-js` module and implements
exactly the client API surface the page uses. After every scenario the test
asserts against the **database** state, not the browser display.

## Status

Requirements R1–R7 **fail against the legacy single-JSON-row implementation**
— deliberately. They document the bugs found in the assessment (silent save
failures, lost concurrent increments, decrements/un-marks/deletions reverted
by other users' unrelated edits, no automatic propagation, misleading
"Offline" label). R8 (basic persistence) passes.

All eight must pass before the per-city schema rework ships, and stay green
afterwards. When the page moves to the new schema, extend `mock-server.js`
and `supabase-stub.js` to model the new tables (`band_cities`,
`band_leaders`, `band_posts`) and RPCs (`band_adjust_counter`,
`band_step_stream_depth`, `band_set_post`). The requirements themselves are
implementation-agnostic and must not be weakened.

Not yet covered here (verify manually or add during the rework): realtime
events arriving *during* an in-flight save must not be discarded; automatic
refetch after reconnection.

## Running

```sh
cd tests/band
npm install
CHROMIUM_PATH=/path/to/chromium npm test   # defaults to /opt/pw-browsers/chromium
```

Screenshots and per-session browser console logs land in `shots/`.
Exit code is non-zero if any requirement fails.
