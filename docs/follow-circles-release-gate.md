# FOLLOW DAILY: Multiplying Circles Release Status

## Live core feature, November 22, 2026

- Circle page and its JavaScript are reachable on https://obey.tools/follow-circles.html. Published-site smoke: GitHub Actions run 45044372077, passed.
- The Circle migration and a separate anonymous RPC permission lockdown are applied to the Obey Tools production Supabase project.
- All 10 new Circle tables have RLS enabled. All 25 previously saved SOS progress rows remain with the same snapshot hash.
- Isolated PostgreSQL 17 database contract tests passed (GitHub Actions run 45043799073), including cross-Circle privacy, hidden progress rules, forbidden steward elevation, and removed-member access checks.
- This is not proof of multi-user browser E2E on production. Real signed-in test accounts and device-level acceptance testing are still recommended.
- **Circle email notifications are not yet sending.** The Resend worker is deployed as `follow-circle-notifications`, but it requires `CIRCLE_NOTIFY_CRON_SECRET`, and the GitHub delivery schedule remains disabled pending secret configuration and an end-to-end delivery test.
- Keep private SOS answers private by default. Never automatically publish someone's personal Say, Obey, Share responses.

## Live: Conversation Box × Circles and church view

- `supabase/migrations/20261123090000_follow_circle_conversations.sql` is applied in production, after the restricted `circle_conversations_prebackup` snapshot (reported on PR #300). Live check, November 22, 2026: `follow_circle_cb_summary` and `follow_church_invite_preview` exist and return "permission denied" to anonymous callers.
- Details and the privacy model: `docs/circle-conversations/README.md`.

## Pending: Circle activities and the daily-reading switcher

- `supabase/migrations/20261124090000_follow_circle_activities.sql` is **not applied anywhere yet**. It is additive, and existing Circles keep both activities.
- `scripts/circles-activities-tests.sql`, `scripts/e2e/circles-unified.e2e.mjs` and `scripts/test-circles-unified.mjs` pass on isolated PostgreSQL and run in the Follow Daily Circles workflow.
- Apply to a test project first, then production after a backup. Run security advisors. Until then the site detects the missing columns and keeps today's behavior.
- Details: `docs/circles-unified/README.md`.

## Previous release checklist (historical planning document)

## Features committed

- Circle create/join/leave, immediate invitation by secret link, independent progress, no membership cap.
- General and passage-based conversations, replies, encouragement, reporting, author blocking, moderation.
- Private optional SOS-to-Circle sharing, explicit multi-Circle selection, user-selected member mentions.
- Steward transfers, member removal, progress visibility, and saved optional email preferences.
- Outbox queue for opt-in replies and mentions; weekly digest code, Resend-compatible idempotency keys.
- Email worker and GitHub schedule present, but schedule remains disabled by default.

## Database migration

`supabase/migrations/20261122120000_follow_multiplying_circles.sql`

Apply to a **test database first**. Use a dedicated test project or authorized Supabase branch, never production for untested migrations. Confirm it is compatible with existing SOS schema and migrations.

Review `security definer` functions closely. Every public function must have explicit EXECUTE grants; authenticated users must not receive direct privileges on invitation hashes or notification queues. Confirm the helper functions cannot enumerate other users' memberships. Run database security advisors.

### Required identity tests (at least two real test accounts)

1. Guest cannot read any Circle, member, post, private journal, invite hash, or notification queue. A guest can preview only the Circle name from a valid link.
2. Account A can create a Circle and get a secret URL; B can join immediately using the link.
3. C without membership cannot query A/B Circle rows or posts, nor invoke progress for that Circle, regardless of guessing a UUID.
4. B sees only A's opted-in day and completion summary, never `say`, `obey`, or `share` values, via direct SQL/Data API and the normal UI.
5. B hides progress. A and the steward both lose access to B's current day and completion.
6. B posts to Circle 1 and Circle 2 explicitly; other Circles must not see either post.
7. B creates a new Circle, independently from the first, retaining personal progress.
8. Revoking invitations blocks old links but does not remove existing members.
9. After removal, the former member cannot read posts or create new ones, even through direct API requests.
10. Members cannot promote themselves by editing `role` or transfer stewardship using an unauthorized function.
11. Blocked authors disappear from the blocker's feed. A reported post can be removed by a steward.
12. Invitations and message spam limits reject excessive requests.
13. Owner account deletion cannot silently destroy all other members' Circle posts. Transfer stewardship first.
14. Joining/leaving does not change SOS progress rows. Snapshot counts before and after.

## UI tests

- iOS Safari and desktop Chrome, signed out and signed in.
- Invitation acceptance from WhatsApp, email magic link redirect, and existing password sign-in.
- Create/rename? Circle rename **not implemented**; scope for later.
- Recent feed, passage filter, comments, reactions, reports, block, member list pagination, progress state.
- At least 300 mock memberships and 500 posts for pagination, scrolling, performance, and notification load.
- Keyboard accessibility, errors/empty states, mobile layout, and offline messaging.
- Confirm private SOS fields are not prefilled in a sharing composer and never enter email payloads.
- Re-run existing Follow Daily and iOS CI checks.

## Resend setup (after tests)

- Sender matches already-established `Follow Daily <daily@obey.tools>`.
- Set Edge secrets: `SUPABASE_URL`, a service-role secret via `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEYS`, `SOS_RESEND_API_KEY` or `RESEND_API_KEY`, and a new random `CIRCLE_NOTIFY_CRON_SECRET`.
- Deploy `supabase/functions/follow-circle-notifications/index.ts` as `follow-circle-notifications`. Keep public JWT verification disabled **only because requests are protected by the separate cron secret**, and ensure the function rejects all requests without that secret.
- Store the same cron secret in GitHub Actions secret `CIRCLE_NOTIFY_CRON_SECRET`.
- In the GitHub repository variables set `CIRCLE_NOTIFICATIONS_ENABLED=true` **only after** one-to-one test sends and a weekly digest dry-run.
- Test notification opt-in, opt-out, blocked authors, group removal, deduplication, retry behavior, and weekly EDT/EST scheduling.
- Update the in-page copy saying email delivery is not enabled only once it has been verified.
- Emails contain no raw post body or private journal text. Do not copy personal reflections into subject lines or notifications.

## Release

Review the PR, take a database backup, snapshot `sos_daily_progress` record counts and existing function definitions, apply the approved migration, deploy/verify worker, turn on scheduler, complete final device tests, merge and publish the website. Include a rollback path for frontend and email scheduler. Do not drop the new tables until retained Circle data has a defined policy.
