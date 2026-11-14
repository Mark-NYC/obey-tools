# Offline-first: what works where, and where data lives

**No internet. No account. No problem.** Every claim in the first table is
checked by `app/tests/offline-first.mjs` (section A: airplane mode, no account),
which runs in CI. Checked in Chromium, not yet on an iPhone. See "Not yet
verified" at the bottom.

## Tool by tool

| Tool | Offline + no account | Saves on device | Optional account sync | Needs internet |
|---|---|---|---|---|
| **Conversation Box** | ✅ add, move, notes, next step: tested. Rename, delete and follow-up date use the same save path but aren't separately tested. Image sharing isn't tested offline. | `conversations`, `submittedEvents`, `submittedGreenLights` | ✅ three-way merge, conflicts kept (below) | Map contributions only. They're queued offline and sent when back online and signed in. |
| **Stories of Hope** (list, selector, 8 stories) | ✅ incl. embedded CSB passages | `hope-*-progress`, `-steps` | ✅ union merge (`command-progress.js`) | Google Forms story requests |
| **4-1-1 (4 Questions)** | ✅ all tabs, presenter, 3 Circles diagram | nothing to save | n/a | n/a |
| **Commands of Christ** (list + 12 studies) | ✅ incl. embedded CSB passages | `command-*-progress`, `-steps` | ✅ union merge | n/a |
| **Church Circle** | ✅ present + assess health, status, generation, baptisms | `churchAssessmentState`, `isChurch`, `churchGeneration`, `baptismCount` | ✅ three-way merge, conflicts kept | n/a |
| Signs of John (8 signs) | ✅ | `john-*-progress` | no (device only) | n/a |
| Bible Study (daily plan) | ✅ plan and reading list | n/a | n/a | **Passage text**: links to BibleGateway (NIV can't be bundled). The Urdu passages are bundled. |
| 3 Circles page | ✅ page | n/a | n/a | **Videos** (YouTube) |
| Progress map, worldwide totals | ❌ | n/a | n/a | Sign-in + internet (live data, map tiles) |
| Leader tools, invites, MAWL checklist, live sessions, Band dashboard | ❌ | n/a | n/a | Sign-in + internet (shared, multi-person data) |
| UCO checklist | ✅ opens | **nothing**: data is lost when you leave the page (also true on the website) | n/a | n/a |

The app's Settings screen shows the same split ("Works offline, no account" /
"Needs internet"). An offline banner appears whenever the phone has no
connection.

## The sync rules (`/local-sync.js`)

1. **The device copy opens first.** A tool never waits for the network. If you're signed in, the account sync happens in the background.
2. **Three-way merge.** Each Conversation Box person, and the Church Circle record, is compared across this device, the account, and the last state both agreed on. Whichever side changed wins.
3. **True conflicts never overwrite silently.** If both sides changed, this device's version is kept, the account's version goes into **Settings → Recovered from sync**, and you get a notice.
4. **Mass-deletion guard.** An empty side (wiped browser, failed upload, empty account) never deletes the other side.
5. **Accounts never mix.** Data synced with account A is never merged into account B on the same phone. Sync pauses with a notice instead.
6. **Failures are harmless.** A failed upload leaves device data untouched and doesn't mark anything as synced. The next save, or coming back online, retries.
7. **Sign-out and account deletion keep device data in the app.** Deletion detaches the device data from the deleted account. The website keeps its existing shared-computer behaviour: sign-out clears the browser, and the data stays safe in the account.

Commands of Christ and Stories of Hope progress keep their existing union merge
(a checked step is never lost; un-checking on one device can come back from
another). That is the safe direction for "never lose progress".

## Storage audit: does data survive restarts and updates?

| Layer | Survives app restart | Survives app update | Survives iOS clearing WebKit data | Notes |
|---|---|---|---|---|
| WKWebView `localStorage` at `capacitor://localhost` | ✅ | ✅ (same bundle ID, scheme and host) | ❌ | Stored under `Library/WebKit`. **Never change** `appId`, `server.hostname` or `iosScheme`, or every user's data becomes unreachable. |
| Native backup `Library/obey-local-data-backup.json` | ✅ | ✅ | ✅ | Written ~0.35 s after every change. Restored only when WebKit storage was wiped (marker missing), and only for **missing** keys. Never overwrites. An unreadable file is never overwritten. In iCloud/device backups. Sign-in tokens are excluded. |
| Supabase account copy | n/a | n/a | n/a | Optional; see sync rules |

**Not used:** sessionStorage (nothing persistent), IndexedDB (nothing in the site),
cookies (none for data).

**Migrations:** none. No key is renamed, moved or deleted by the app. The keys
are the website's existing ones, so behaviour matches the website exactly.

### Device keys

| Key(s) | Tool | Personal? |
|---|---|---|
| `conversations`, `submittedEvents`, `submittedGreenLights`, `user-name` | Conversation Box | **Yes**: names/notes about other people |
| `churchAssessmentState`, `isChurch`, `churchGeneration`, `baptismCount` | Church Circle | Yes |
| `command-*-progress(-steps)`, `hope-*-progress(-steps)`, `john-*-progress` | Studies | Low |
| `obey-local-owner`, `conversations-synced`, `churchAssessment-synced`, `obey-sync-recovery`, `obey-pending-map-events` | Sync bookkeeping (new) | Contains copies of the above |
| `obeytools_lang`, `onboarding-*`, `*-hint-seen`, `loc-permission-seen`, `vp_*`, `band_device_id`, `obeyapp_reminder` | Preferences | No |
| `obey-tools-auth` | Supabase session | Secret: **excluded** from backup and export |

## Not yet verified (needs a real iPhone or Simulator session)

- Airplane mode on a device: the tests emulate it in Chromium with every off-device request blocked. Real WKWebView behaviour (especially `navigator.onLine` and Supabase timeouts on captive networks) still needs a device check.
- Native backup round trip: the Swift side is compiled in CI, and the JS side is tested with the Filesystem plugin's browser implementation. A real "clear WebKit data → relaunch → restored" check needs a Simulator or device. Development checklist item.
- iOS storage eviction itself is rare and can't be forced reliably. The backup is the mitigation.
