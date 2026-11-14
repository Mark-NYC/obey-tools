# TestFlight and App Store release

**Nothing here has been done.** No enrolment, purchase or submission has been
made. This is the plan for when you're ready.

## What needs the paid Apple Developer Program ($99/year)

| Needs paid membership | Works free |
|---|---|
| TestFlight (internal and external testers) | Simulator (on a Mac) |
| App Store submission and distribution | Your own iPhone via Xcode, re-signed every 7 days |
| App Store Connect: listing, privacy labels, screenshots | Everything in CI (unsigned builds, Simulator launch) |
| Distribution certificate and provisioning profiles | Local notifications, share sheet, haptics |
| Universal Links (confirm/reset emails open the app) | |
| Push notifications (not used) | |

Credentials needed at release time (none exist in this repo, and none should be
committed): an Apple Developer account, the Team ID, and for CI uploads an
**App Store Connect API key** (Issuer ID, Key ID, `.p8`) stored as GitHub
encrypted secrets.

## Blockers to clear before the first submission

1. **Account deletion (Guideline 5.1.1(v)).** The app lets people create accounts,
   so it must let them delete their account in the app. The UI exists (Settings →
   Delete account). The server function is drafted in
   `supabase/account-deletion/` and **needs your review and approval to apply**.
2. **Privacy policy.** App Store Connect requires a privacy policy URL, and the app
   should link to it. obey.tools has none. Publish one (for example
   `https://obey.tools/privacy`), then add a link in Settings → About.
3. **Support URL** for the listing (a contact page or email on obey.tools).
4. **Device testing** with the checklist in development.md.
5. **App Privacy "nutrition label"** in App Store Connect. A likely accurate draft
   (verify): *Data linked to you:* email address (account), user content
   (progress, notes), coarse location (only when submitted to the map).
   *Tracking:* none. GA is stripped from the app.
6. **Privacy manifest.** Capacitor and its plugins ship their own
   `PrivacyInfo.xcprivacy`. If you add native SDKs later, check theirs. Apple
   rejects uploads that use required-reason APIs without declared reasons.

## Guideline 4.2 (minimum functionality): our case

Apple rejects apps that are "a repackaged website". Notes for App Review:

> OBEY.TOOLS is a discipleship toolkit used in low-connectivity settings. The
> app bundles every tool for offline use (the website requires a connection),
> adds a native tab bar and swipe navigation, daily on-device reminders to act on
> what users learn, the native share sheet for sharing generated images and
> links, and in-app account management including account deletion.

If App Review pushes back, the strongest next additions are: offline
download/notes for Bible Study passages, a home-screen widget ("today's
command"), and native Conversation Box storage.

## Release steps

1. Enrol (Individual or Organization; an Organization needs a D-U-N-S number and
   shows the org name as the seller).
2. **App Store Connect → Apps → +**: platform iOS, name "Obey Tools" (or
   "OBEY.TOOLS"), bundle ID `tools.obey.app` (register it under Certificates,
   IDs & Profiles first), SKU `obey-tools-ios`.
3. In Xcode: Signing → choose your **paid team** (not Personal Team). Set
   `MARKETING_VERSION` (1.0.0) and bump `CURRENT_PROJECT_VERSION` for every upload.
4. Archive: **Product → Archive** (destination "Any iOS Device") → Organizer →
   **Distribute App → App Store Connect → Upload**. Or automate it in CI with the
   API key: `xcodebuild archive` + `xcodebuild -exportArchive` with
   `-allowProvisioningUpdates` and `-authenticationKeyPath`.
5. **TestFlight**: internal testers right away (up to 100). External testers need a
   short Beta App Review.
6. Listing: description, keywords, category (Reference or Lifestyle), age rating
   questionnaire, screenshots (6.9" iPhone required; 6.5" optional), privacy policy
   URL, support URL, App Privacy answers, export compliance (already set:
   `ITSAppUsesNonExemptEncryption = NO`, HTTPS only).
7. **App Review Information**: give a **demo account** (email/password) so the
   reviewer can see sign-in, sync and delete account. Paste the 4.2 notes above.
8. Submit. Review usually takes 1–3 days.

## Later (each needs the paid program)

- **Universal Links**: host `/.well-known/apple-app-site-association` on
  obey.tools, add the Associated Domains capability, and add the app's redirect to
  Supabase's allowed redirect URLs. Confirm and reset emails then open in the app.
  This changes production config, so it needs approval at that point.
- **Push notifications**: only if reminders need to come from the server.
