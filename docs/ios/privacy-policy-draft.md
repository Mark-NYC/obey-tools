# OBEY.TOOLS Privacy Policy (DRAFT)

> **Draft for review, not published.** Written from what the code actually does
> (November 2026, branch `claude/keen-heisenberg-czraan`). Items marked
> **[CONFIRM]** need an answer from you. Have someone qualified review it
> before you publish it at obey.tools/privacy and link it from the app and the
> App Store listing. Apple requires a privacy policy URL before submission.

_Last updated: [DATE]_

OBEY.TOOLS ("we") makes simple disciple-making tools: Conversation Box,
Stories of Hope, 4-1-1, Commands of Christ and Church Circle, on the
website obey.tools and in the OBEY.TOOLS iPhone app. **[CONFIRM: legal
name/organisation and contact email.]**

## The short version

- **No account needed.** Every tool works without an account and, in the app, without internet.
- **What you enter stays on your device** unless you choose to sign in.
- **If you sign in**, a copy of your tool data is stored in your account so it syncs across your devices.
- **The app has no ads, no tracking and no analytics.** We don't sell data.
- **You can export your data** (in the app: Settings → Export) and **delete your account** (Settings → Delete account).

## 1. Information stored on your device

The tools save what you enter in your browser's or the app's local storage on
your device:

- **Conversation Box:** the first names or nicknames of people you're talking with, which box they're in, and your optional next steps, notes and follow-up dates.
- **Church Circle:** your assessment, church status, generation and baptism count.
- **Commands of Christ, Stories of Hope, Signs of John:** which steps you've completed.
- **Other:** the name you enter for sharing, your language, reminder time and display preferences.

This stays on your device. In the iPhone app it is also copied to a file in the
app's private storage, so it survives app updates. That file is included in your
iPhone or iCloud backup like other app data. We cannot see any of this unless
you sign in and sync.

**Please be thoughtful about what you write about other people.** Use first
names or nicknames, and nothing you wouldn't want them to read.

On the **website**, signing out clears this data from the browser, in case the
computer is shared. In the **app**, signing out keeps it on your phone.

## 2. Information stored if you create an account (optional)

We use Supabase (supabase.com) to host accounts and synced data.
**[CONFIRM: project region.]** If you create an account we store:

- **Account:** your email address and a password. Supabase stores the password hashed; we never see it. Your role (for example "leader") is also stored.
- **Synced tool data:** the device information in section 1 for Conversation Box, Church Circle, and Commands/Stories progress, so it can sync to your other devices.
- **Leaders:** networks and checklists you create, people you invite (their email address, if you enter one), and live-session summaries (attendance numbers).

## 3. Location (optional, only if you allow it)

When you move someone into **Spiritual** or **Discovery** in Conversation Box
while signed in, the app may ask for your location. This adds a dot to the
shared progress map. If you allow it:

- Your device's location is sent to our server (Supabase), and if that fails, to OpenStreetMap's Nominatim service. Either one converts it to a city, region and country.
- **Before anything is stored, the coordinates are rounded:** to about 1 km, or about 11 km with city-only names in countries where following Jesus is dangerous.
- We store the rounded location, the place name, the date and the type of milestone. **We never store the name of the person you were talking with with a map point.**
- Signed-in leaders see aggregate counts and approximate locations on the map, never individual names.

If you decline, the milestone is counted without a location. You can change this
any time in iPhone Settings → Privacy & Security → Location Services → OBEY.TOOLS.

**[CONFIRM: Nominatim's own privacy policy applies to requests sent there; link it.]**

## 4. What we don't do

- No advertising, no data sales, and no tracking across other apps or websites.
- **App:** no analytics or crash-reporting SDKs. Google Analytics is removed from the app.
- **Website:** obey.tools uses **Google Analytics** to count visits. **[CONFIRM whether to keep this; if kept, describe it and its cookies, and add a consent banner where required (EU/UK).]**

## 5. Third parties

| Service | Why | What it receives |
|---|---|---|
| Supabase | Accounts and sync (only if you sign in), map | Email, synced tool data, rounded location |
| OpenStreetMap Nominatim | Fallback for turning a location into a place name (only if you allow location) | Coordinates, at the moment of lookup |
| Esri / ArcGIS | Map tiles on the progress map | Your IP address and the map area viewed |
| YouTube | Videos you choose to play | Standard YouTube data |
| Google Forms | Story request forms you choose to open | Whatever you submit |
| Google Analytics | Website visit counts (not in the app) | Website usage data |
| Apple | Notifications are scheduled on your iPhone itself | Nothing from us |

## 6. Your choices and rights

- **Export:** in the app, Settings → Export a copy of my data.
- **Delete your account:** in the app, Settings → Delete account. This deletes your sign-in and the data stored in your account. **[CONFIRM: the server function is reviewed and applied; see `supabase/account-deletion/`.]** It does not delete what's on your phone. Delete the app to remove that.
- **Without the app:** **[CONFIRM: contact email]**. We answer within **[30]** days.
- **Retention:** account data is kept until you delete it. **[CONFIRM: backup retention period at Supabase.]**

## 7. Children

The tools are not directed at children under 13. **[CONFIRM: age rating answer in App Store Connect.]**

## 8. Changes

We'll update this page and its date when this changes.

## 9. Contact

**[CONFIRM: name, email, postal address if required.]**

---

### App Store Connect "App Privacy" answers (draft, matches the above)

- **Data linked to you** (only when signed in):
  - Contact Info: email address (app functionality)
  - User Content: other user content, meaning Conversation Box notes and tool progress (app functionality)
  - Location: coarse location (app functionality; shown on the map in aggregate)
- **Data used to track you:** none
- **Data not collected:** usage data, diagnostics, identifiers, purchases, browsing history (in the app)
