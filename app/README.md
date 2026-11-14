# app/: OBEY.TOOLS iOS app (Capacitor 8)

Packages the website at the repo root as an offline-capable iOS app. The site is
copied and changed at build time; the website itself is never modified.

```sh
npm ci
npm run build     # → www/
npm test          # offline smoke test (Playwright Chromium)
npx cap sync ios  # → ios/App
```

- `scripts/build-web.mjs`: copy, vendor CDNs, strip GA, inject shell
- `native-shell/`: tab bar, safe areas, share, haptics, offline banner, Settings page
- `ios/App/App/ObeyBridgeViewController.swift`: GitHub-Pages-style router, swipe-back
- `tests/offline-smoke.mjs`: every page, offline, iPhone-sized

Full docs: [`docs/ios/`](../docs/ios/README.md).
