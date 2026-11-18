# OBEY.TOOLS — App Store 1.0 release packet (draft, 2026-11-18)

**Status:** Build 1.0.0 (3) uploaded and Ready to Test in App Store Connect, but **not ready for App Review**. Keep release manual. No production database or website changes have been authorized by this document.

## App Store copy

App name: OBEY.TOOLS

Subtitle: Simple Disciple-Making Tools

Promotional text: Simple tools to understand, obey, and pass on the commands of Jesus. Use them anywhere, even without internet.

Description:

OBEY.TOOLS helps you understand, obey, and pass on the commands of Jesus.

Whether you are meeting a friend, studying Scripture, equipping a new disciple, or gathering with a simple church, you'll have practical tools ready whenever you need them.

TOOLS INCLUDED
• Conversation Box: keep track of people and conversations.
• Stories of Hope: discover and share Bible stories.
• 4-1-1 (4 Questions): introduce a simple discipleship framework.
• Commands of Christ: study and apply Jesus' commands.
• Church Circle: assess and discuss life together as a church.

BUILT FOR EVERYDAY DISCIPLE-MAKING
• Core resources available offline.
• No account required to begin.
• Keep notes and progress on your device.
• Optionally sign in to sync supported data when connected.
• Share links and resources using your iPhone.
• Set an optional daily reminder.

OBEY.TOOLS is built to keep the focus on following Jesus and helping others do the same.

Keywords (verify length in App Store Connect): discipleship,bible,Jesus,church,Scripture,obedience,evangelism,training

Suggested primary category: Reference. Secondary: Education, if suitable.

Price: Free. No in-app purchase in this build.

## App Review notes (draft)

OBEY.TOOLS is an offline-first disciple-making toolkit. The app packages instructional content and interactive tools for use without reliable connectivity, and provides native iOS navigation, local reminders, native share functionality, durable local backups, and optional account sync.

To test without credentials: open the app, select any tool from Home, turn on airplane mode, then use the tools. Some online services, including cloud sync, need internet.

Provide App Review with a working demo login to exercise account creation/sync/deletion, if those features remain included. Do not put actual credentials in this GitHub file; put them only in App Store Connect's secure App Review Information section.

## Blocking issues (must resolve before submission)

1. **Account deletion NOT DEPLOYED.** The UI calls `delete_my_account`, but the migration at `supabase/account-deletion/01_delete_my_account.sql` is marked draft/not applied. Before running it, identify the actual Supabase project, inspect live FK constraints, review shared-object behavior, test on an isolated account, and confirm full deletion. Never apply this blindly to production.
2. **Privacy policy missing.** Publish an accurate accessible page on obey.tools AND link to it from the app Settings screen. Include a verified contact method and retention/deletion details. Website Google Analytics exists, while the app build strips it. Optional Supabase accounts can store email, progress, people/notes and map contributions; on-device data may be backed up in iOS backups. Verify precise location handling, third parties, tracking, data categories, and retention before completing Apple's privacy questionnaire.
3. **Support URL missing/needs confirmation.** Provide a working public support/contact URL.
4. **Real-device QA missing.** Test build on physical iPhone, including airplane mode, Conversation Box create/edit/restore, Church Circle, account login/logout, syncing, settings, sharing, notifications and deletion.
5. **Store assets.** Produce real device screenshots (not just mocked UI), check icon, complete age rating, app availability, export compliance, privacy disclosure and any rights declarations.
6. **Distribution workflow restriction.** Existing `.github/workflows/testflight.yml` explicitly exports *internal TestFlight only*. Public App Store submission requires a different appropriately signed submission-capable build. Do not assume the current build 3 can be sent to public App Review.
7. **App review rights/content.** Confirm rights to bundled Bible translations and localized content before distribution.

## Publication

Do not auto-release. Set the distribution release option to **manually release this version** after review. Public submission requires explicit approval after the blockers above are resolved.

## Verification notes

Based on files inspected on `claude/keen-heisenberg-czraan`: `app/scripts/build-web.mjs`, `app/native-shell/app-shell.js`, `app/native-shell/pages/app-settings.html`, `supabase/account-deletion/README.md`, `supabase/account-deletion/01_delete_my_account.sql`, `docs/ios/release.md`, and successful TestFlight run shown in App Store Connect. This document records proposed metadata, not a filed App Store submission.
