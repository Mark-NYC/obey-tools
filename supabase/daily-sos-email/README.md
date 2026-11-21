# Follow Daily email delivery

Visitors can subscribe without an Obey.Tools account. They enter email, time zone and delivery hour on the Follow Daily page. A dedicated confirmation email is sent via Resend. The confirmation link opens a page requiring an explicit confirmation click, protecting against automated email link scanners. No subscriber is active before confirmation.

## How it works

- `daily-sos-email.js` submits directly to the Supabase Edge Function's `/subscribe` endpoint. It does not call Supabase Auth or send magic-link logins.
- `supabase/daily-sos-email/03_email_only_confirmation.sql` permits subscriptions without a user account, adds temporary confirmation tokens expiring after 24 hours, and enforces rate limits by email and requester fingerprint.
- `/confirm` starts/resumes the confirmed address at the chosen local delivery hour, preserving existing progression and any linked account. First reading is scheduled for the following local day.
- `/manage` offers pause, resume and unsubscribe by an unguessable per-subscriber link included in every reading email. Neither an account nor password is required. Unsubscribe remains separately supported for one-click email-client headers.
- `daily-sos-readings.js` and `daily-sos-scripture.js` are the canonical 365 readings and public-domain WEB Updated text. The Edge Function has synchronized typed copies. Tests check equality.
- `supabase/daily-sos-email/01_schema.sql` manages the subscriber delivery ledger and 90/day protection; `02_schedule.sql` calls the Edge Function every ten minutes.
- The sender uses `SOS_RESEND_API_KEY`, `RESEND_API_KEY` or `sos_resend_api_key` stored as a Supabase Edge Function Secret. Database Vault lookup remains a fallback. No client-side keys.
- Obey.Tools Resend's `obey.tools` domain is authenticated. Click/open tracking is disabled.

## Safety and operations

- Public signup requests are throttled by per-email and per-requester fingerprints. Invalid time zones and malformed input are rejected.
- Pending confirmation tokens and send receipts are locked down by RLS and service-role-only grants. Existing authenticated subscriptions are preserved.
- Confirmation links are one-use after completion and expire after 24 hours. Link GET shows a confirmation button; only POST activates delivery, preventing automated email-link prefetch from subscribing people.
- People can read or record SOS without subscribing. Signup never adds anyone to marketing.
- Subscribers may pause, resume or unsubscribe through links inside reading emails. Their SOS journal is unaffected.
- The service uses a fixed Resend idempotency key per subscription + reading day, lease-based work claiming, retry cap, and an adjustable daily limit.
- Automated delivery status: `public.sos_email_runtime.enabled`. The readiness endpoint is `/health` and returns only a boolean.
- The protected scheduler authenticates with the secret stored in the database runtime record. Never expose it or the API key in logs or source code.

## Verification

Run `node --test tests/daily-sos-schedule.test.mjs tests/daily-sos-email.test.mjs`. A controlled email-only signup test on November 21, 2026 returned HTTP 200 and Resend confirmed the dedicated **Confirm your Follow Daily emails** message was delivered; the subscription stayed pending until the user took the confirmation action.

SQL checks:
```sql
select enabled, daily_limit, max_per_run from public.sos_email_runtime where singleton;
select count(*) from public.sos_email_pending;
select status, count(*) from public.sos_email_subscriptions group by status;
select status, count(*) from public.sos_email_deliveries group by status;
```

To pause all delivery safely:
```sql
update public.sos_email_runtime set enabled=false,updated_at=now() where singleton;
```
