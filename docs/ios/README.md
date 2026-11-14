# OBEY.TOOLS iOS app

Status: **first working build, not yet run on a physical iPhone.** CI compiles
it for the iOS Simulator and for iPhone hardware (unsigned) and launches it in
the Simulator. Nobody has tested it on a real device yet.

- [development.md](development.md): local dev, CI, Xcode, Simulator, installing on your own iPhone with a free Apple ID
- [release.md](release.md): TestFlight / App Store steps, what needs the paid membership, review checklist

## Repository audit (November 2026)

| Area | What the repo actually is |
|---|---|
| Framework | None. About 50 hand-written static HTML pages with inline CSS and JS, ES modules (`auth.js`, `i18n.js`, `supabase.js`, …). No bundler, no `package.json` at the root. |
| Hosting / deploy | GitHub Pages from the repo root (`CNAME` → obey.tools). Pushing to `main` deploys. No CI before this branch. |
| Routing | Multi-page site with **extensionless links** (`href="commands-of-christ"`, `/bible-study/`), which GitHub Pages resolves to `.html` / `index.html`. Two folder stubs (`band/`, `stories-of-hope/`) are redirects. |
| Auth | Supabase Auth, email + password, implicit flow. Session kept in `localStorage` (`obey-tools-auth`). Email confirm and reset links go back to `location.origin`. Roles come from `profiles.role` (`leader` / `user`). |
| Data | Supabase Postgres (project `mjiswwujcsmayuytoaul`): about 18 tables (progress, conversations, assessments, networks, checklists, band, live sessions) plus RPCs. Lots of state is device-only in `localStorage` (Conversation Box, John progress, language). |
| Third-party code | Loaded from CDNs: supabase-js 2.110.6 (jsDelivr), html2canvas, qrcode-generator, Leaflet (unpkg), Google Analytics on 47 pages. Map tiles from ArcGIS, reverse geocoding from Nominatim. |
| i18n | 12 languages via `lang/*.json`, RTL for Arabic/Urdu, bundled Urdu Bible text. |
| PWA | `manifest.json` plus a no-op service worker. No offline caching. |
| Tests | `tests/i18n` (Urdu, Playwright), `tests/band` and `tests/live` (mock Supabase). |

**What this means for iOS:** nothing has to be rewritten. The whole site can be
bundled into the app. The work is making a multi-page, CDN-dependent website
behave like an offline native app without changing the live site.

## Approach: Capacitor 8, site bundled in the app

The website stays the single source of truth. `app/` holds a Capacitor 8.6
project. `app/scripts/build-web.mjs` copies the site into `app/www`, changes
**only that copy**, and the copy ships inside the app. The live website is
untouched; no files outside `app/`, `docs/ios/`, `supabase/account-deletion/`
and `.github/` changed on this branch.

Why not point the app at `https://obey.tools` (`server.url`)? That is the
"website wrapper" Apple rejects under Guideline 4.2. It also would not work
offline, and every site deploy would ship to app users without review.

### What the app does that the website can't

| Feature | How |
|---|---|
| **Works offline** | Every page, script, font, language file and the Urdu Bible are bundled. All CDN libraries are vendored. The build **fails** if any page still references a CDN. Supabase calls fail gracefully offline, and an offline banner explains what still works. |
| **Native tab bar** | Home · Commands · Stories · Settings on hub pages, with blur and haptics. Tapping the active tab scrolls to the top. Stories switches to Signs of John in Ukrainian time zones, the same as the site. |
| **Swipe-back navigation** | Native edge-swipe between pages (`ObeyBridgeViewController`). |
| **Native share sheet** | `navigator.share` for links **and generated images** (Conversation Box, Church Circle) goes through the iOS share sheet. `<a download>` links, which WKWebView ignores, open the share sheet so people can Save Image or Save to Files. Shared links are rewritten to `https://obey.tools/...`, never `capacitor://localhost`. |
| **Daily reminder** | An optional local notification ("What is Jesus asking you to obey today, and who will you tell?"). Tapping it opens Commands of Christ. On-device only: no server, no push certificate. |
| **Settings screen** | Account (sign in/out, **delete account**), reminder, language, offline library, share the app, version. |
| **In-app browser** | External links open in an in-app Safari sheet. Links to obey.tools open the bundled page. |
| **Safe areas and status bar** | `viewport-fit=cover` plus CSS insets, a blurred status-bar scrim, and a status bar that switches to light text over dark pages and the dark sign-in overlay. |
| **Startup** | A branded launch screen (the site's Bebas Neue wordmark) hands off to the first painted page with a short fade. There's a 2.5 s safety timeout, so the splash can never hang. |

### What changes in the app copy (never on the website)

1. CDN URLs → bundled `/vendor/...` files (same pinned versions).
2. Google Analytics removed. This keeps the App Store privacy label to "no tracking". Add native analytics later if you want it.
3. Service-worker registration disabled (not supported on the app's URL scheme).
4. `location.origin` → `https://obey.tools`, so auth emails and shared links point at the website.
5. Native shell (`app/native-shell/`) injected into every page.
6. Two unlinked developer test pages (`*-live-test.html`, `live-join-test.html`) left out.

### Accounts and data are preserved

- The app uses the **same Supabase project and keys**, so existing accounts sign in unchanged.
- **Email confirmation and password reset** links open the website in Safari (`https://obey.tools/...`). Users confirm or reset there, then sign in from the app. No Supabase redirect settings were changed. Opening those links directly in the app needs Universal Links (paid membership; see release.md).
- **Device-only data** (for example Conversation Box people saved in the browser) is per app. Safari's `localStorage` and the app's are separate, so web-only data does not move into the app. Data synced to an account does.
- **Never change** `appId` (`tools.obey.app`) or the Capacitor hostname/scheme after release. The app's local data is tied to them.

### Native code

- `app/ios/App/App/ObeyBridgeViewController.swift`: the custom router that resolves extensionless links the way GitHub Pages does. Capacitor's default would send every extensionless link back to Home. Also handles swipe-back and background colour.
- `Info.plist`: location usage text (maps), export-compliance flag (HTTPS only), iPhone-only, portrait plus landscape (4-1-1 presenter).

## Known issues and limitations

- **Not device-tested.** It is Simulator-launched in CI only.
- **Account deletion needs a server function** (`supabase/account-deletion/`). It is drafted, **not applied**. Until it is, the Delete button says deletion isn't enabled and changes nothing. This **blocks App Store submission**.
- **No privacy policy page exists** on obey.tools. One is required for submission.
- App-only labels (tab bar, Settings, offline banner) are English only for now. Site content stays fully translated.
- Pre-existing website bug found by the new tests: `conversation-box.html` throws `Cannot read properties of undefined (reading 'length')` in `updateDisplay()` on first load at phone size (`conversations` is still `{}`). It is also on the live site; left unfixed here.
- Videos (YouTube), maps, sign-in and sync need a connection, as expected.
