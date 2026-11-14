# Developing the iOS app

## Day-to-day: you only edit the website

Keep editing the HTML/JS/CSS at the repo root as before. The app picks up the
changes on its next build. App-only code lives in `app/native-shell/`.

## Without a Mac (Claude Code Web / any Linux or Windows machine)

Everything except the Xcode build runs anywhere with Node 22+:

```sh
cd app
npm ci
npm run build      # site → app/www (vendored, offline, shell injected)
npm test           # offline smoke test of every page (needs Playwright Chromium)
npx cap sync ios   # copy www + plugin config into the Xcode project
```

`npm test` serves `app/www` with the same routing rules as the iOS app and
**blocks all network traffic**. Then it opens every page at iPhone size and
fails on script errors, missing bundled files, a missing tab bar or horizontal
overflow. Screenshots go to `app/test-output/`. If Playwright can't find a
browser, set `CHROMIUM_PATH=/path/to/chromium`.

Preview the bundle in a desktop browser with `npx serve app/www`. The shell
runs in "web mode": the tab bar and layout show, and native plugins are skipped.
Extensionless links won't route there; open `.html` URLs.

Regenerate the icon and launch images after a branding change: `npm run assets`.

## Cloud iOS builds: GitHub Actions

`.github/workflows/ios.yml` runs on every pull request and on pushes that touch
the app or the site:

1. **web** (Linux): build plus offline smoke test. Uploads screenshots.
2. **ios** (macOS): `xcodebuild` for the **Simulator** and for **iPhone hardware
   (Release, unsigned)**. Then it boots an iPhone Simulator, installs and launches
   the app, checks it's still running after 15 s, and saves screenshots and app
   logs as the `ios-simulator-output` artifact.

No signing certificates, Apple ID or secrets are used. To run it by hand: GitHub
→ Actions → **iOS app** → *Run workflow*. Screenshots are under the run's
**Artifacts**.

> macOS runner minutes cost 10× Linux minutes on private repos. On a public repo
> they're free. If minutes matter, limit the `ios` job to pull requests and
> manual runs.

What CI can't tell you: how it *feels*, real performance, share-sheet and
notification behaviour, and anything on a physical device.

## On a Mac (when you have access to one)

Need: macOS with **Xcode 26+** (App Store uploads have required the iOS 26 SDK
since 28 April 2026), Node 22+.

```sh
cd app && npm ci && npm run sync && npx cap open ios
```

Xcode opens `ios/App/App.xcodeproj`. Swift packages resolve on first open
(about 1 min).

### Simulator

1. In the toolbar, pick the **App** scheme and an iPhone simulator (for example iPhone 17).
2. Press **⌘R**.
3. Debug the web layer: Safari → Settings → Advanced → *Show features for web
   developers*. Then Safari → Develop → *Simulator* → `localhost`. You get the full
   Web Inspector on the running app.
4. Test offline: turn off the Mac's Wi-Fi (the Simulator shares the Mac's network).

After any web change: `npm run sync`, then ⌘R again.

### Your own iPhone with a free Apple Account (no $99 membership)

1. Xcode → Settings → **Accounts** → **+** → Apple Account → sign in.
2. Select the **App** target → **Signing & Capabilities** → tick *Automatically
   manage signing* → **Team: "Your Name (Personal Team)"**.
3. If Xcode says the bundle ID is taken, change it to something unique (for example
   `tools.obey.app.yourname`). That's for personal testing only; keep
   `tools.obey.app` for release.
4. Plug in the iPhone, tap **Trust This Computer**, pick it in the device menu, press **⌘R**.
5. On the iPhone, turn on **Settings → Privacy & Security → Developer Mode**
   (restart required).
6. First launch only: **Settings → General → VPN & Device Management** → your Apple
   Account → **Trust**.

Free-account limits (from Apple, subject to change):

- The app **stops opening after 7 days**. Reconnect and press ⌘R to re-sign.
- At most 3 sideloaded apps per device at once. Your own devices only.
- No TestFlight, no App Store, no sharing with testers.
- Capabilities that need the paid program are unavailable: push notifications,
  Associated Domains (Universal Links), Sign in with Apple, iCloud, App Groups.
  **This app uses none of them.** Local notifications, share sheet, haptics,
  network status and the file cache all work on a free account.

### Device test checklist (do this before saying "device-tested")

- [ ] Cold start: splash → Home with no white flash; status bar readable
- [ ] Tab bar: all four tabs; active tab highlighted; tap active → scroll to top
- [ ] Swipe from the left edge goes back on detail pages
- [ ] Extensionless links (Home → Commands → Be Baptized → back) open the right pages
- [ ] Airplane mode: offline banner; Commands, 4-1-1, 3 Circles, Stories, Bible Study all open
- [ ] Sign in with an existing account; progress syncs; sign out
- [ ] Sign up: confirmation email opens obey.tools in Safari; then sign in in the app works
- [ ] Forgot password: reset on the website; sign in in the app with the new password
- [ ] Conversation Box image share → share sheet → Save Image works
- [ ] Conversation Box Guide download → share sheet
- [ ] Progress page share → link is `https://obey.tools/...`
- [ ] Leader Tools copy invite → pasted link is `https://obey.tools/...`
- [ ] External link (YouTube, Church Waffle) opens in an in-app Safari sheet
- [ ] Settings → Daily reminder → allow → set the time 2 min ahead → notification arrives → tap opens Commands
- [ ] Location prompt shows the usage text; map pages work
- [ ] Urdu / Arabic: RTL layout, tab bar still usable
- [ ] VoiceOver: tab bar items read as "Home, tab"-style links with labels; Settings switch announces state
- [ ] Larger Text (Settings → Accessibility → Display & Text Size): text still readable
- [ ] Rotate on the 4-1-1 presenter
