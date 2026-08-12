# Live facilitation — two-browser flow test

Drives the real, unmodified **test** pages in two separate Chromium contexts —
one facilitator, one participant — to prove the live flow end to end:

- `hope-for-the-rejected-live-test.html`
- `live-join-test.html`

The Supabase RPCs (`live_create_session`, `live_set_step`, `live_end_session`,
`live_get_by_code`), the public `live_sessions` select, and realtime are
replaced by a local mock (`mock-server.js`) whose semantics mirror
`supabase/live-facilitation/01_schema.sql`. `supabase-stub.js` is served in
place of the CDN `@supabase/supabase-js` module; the CDN QR library is aborted
so the graceful offline QR fallback is exercised.

## Run

```
npm install            # installs playwright-core
npm test               # starts the mock, runs run.js, reports PASS/FAIL
```

Chromium is taken from `CHROMIUM_PATH` (default `/opt/pw-browsers/chromium`).
Screenshots and console logs land in `shots/`.

## What it checks (19 assertions)

Entire 3/3 process visible as one list; no per-item progress/completion/reset
UI; facilitator starts a session; safe 4-char code; share link → test story
page; QR renders or degrades; participant joins via direct link and via the
code page; facilitator UI vs participant UI; live highlight propagation on
Next / Previous / row-tap; participant cannot change the shared highlight;
refresh reconnects; Done opens the two-number report; goal ≤ present validation;
save records the report and ends the session; participants see a closing state;
an ended code no longer joins. Runs at 390px width.
