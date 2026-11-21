# Daily SOS email delivery

One reading per day, starting the morning after each subscriber explicitly joins. The 365-day content library lives in GitHub; Resend sends one individualized message through the Obey.Tools account.

## Architecture

- \`daily-sos-readings.js\`: canonical 365-day reading schedule.
- \`daily-sos-scripture.js\`: canonical public-domain World English Bible Updated (WEBU).
- \`supabase/functions/daily-sos-delivery/readings.ts\` and \`scripture.ts\`: copies of those canonical sources for the Edge Function. If readings change, regenerate/check both copies. GitHub tests check they match.
- \`daily-sos-email.js\`: optional, verified-email enrollment, pause, resume, and settings UI.
- \`supabase/daily-sos-email/01_schema.sql\`: subscribers, delivery ledger, RLS, dispatch lock and helpers, disabled-by-default config.
- \`supabase/daily-sos-email/02_schedule.sql\`: a \`pg_cron\` job every 10 minutes, invoking the Edge Function with a secret stored in the restricted runtime table.
- \`supabase/functions/daily-sos-delivery/index.ts\`: authenticated-cron dispatch, full Scripture email, safe unsubscribe endpoint. Requires a verified sender and a sender credential stored as a Supabase Edge Function Secret (preferred) or in Supabase Vault. Sends nothing unless runtime is deliberately enabled.
- Resend topic: **Daily SOS Reading Emails** (default opt-out). Subscription permission is owned by the Supabase table, not by a separate newsletter list.

The user signs in via the Supabase passwordless email OTP flow (already supported in the existing Obey.Tools project). An email address is never added to daily emails merely because the user visits the page or signs into Obey.Tools. A subscriber chooses a sending hour and IANA time zone and opts in. First email is scheduled for the following local calendar day. Resuming from a pause retains the next reading number and schedules it for the following local day. A person may use the site without subscribing.

## Deployment status

- SQL schema and cron scheduler applied in **Obey Tools** Supabase project (\`mjiswwujcsmayuytoaul\`).
- Edge Function deployed with \`verify_jwt=false\` because the scheduler is protected by a **32-byte secret header**, and unsubscribe is a public tokenized endpoint.
- Tested: health returns HTTP 200 with \`ready:false\`; unauthorized dispatch returns 403; authorized dispatch returns \`enabled:false, sent:0\`.
- **Sending is OFF** in \`public.sos_email_runtime\`. Keep it that way until the restricted Resend key is installed and a controlled end-to-end send test is complete.
- Tracking subdomain \`sent.obey.tools\` was not verified in Resend. Since the account's domain click tracking is enabled, verify that links are not rewritten to a broken tracking hostname. Either correct the \`sent\` CNAME to the value Resend displays or deliberately disable click tracking in the Resend dashboard (check other uses of this domain first).

## Remaining activation steps

1. In the **Obey.Tools Resend account** create a sending-only API key scoped to the verified \`obey.tools\` domain. **Never commit the key or paste it into chat.**
2. In the **Obey Tools Supabase dashboard**, open Database > Vault and create a secret named \`sos_resend_api_key\` with that Resend token as the value. The restricted \`sos_resend_token()\` RPC reads it only for the service role. Do not put credentials into \`daily-sos.html\`, GitHub files, or public environment variables.
3. Fix the Resend click-tracking DNS failure, or explicitly turn off tracking for that sending domain after reviewing existing emails.
4. Run a controlled end-to-end test with a verified Obey.Tools user account; confirm subject, Scripture text, links, unsubscribe behavior, and time-zone delivery without sending to a real audience.
5. After a successful test, in the Supabase SQL Editor **explicitly opt in to activating the sender**:

\`\`\`sql
update public.sos_email_runtime
set enabled=true, updated_at=now()
where singleton=true;
\`\`\`

To pause all sends immediately:

\`\`\`sql
update public.sos_email_runtime
set enabled=false, updated_at=now()
where singleton=true;
\`\`\`

After activation, the next cron run will send due subscriber messages; the browser signup controls will report the service is ready. No one is enrolled automatically. No manual backlog or 365 separate Resend broadcasts are needed.

## Delivery safeguards

- Verified email identity via Supabase Auth and RLS; user cannot select another user's email.
- User-facing preferences are owner-only; delivery ledger, cron key, and sender credential are inaccessible from unauthenticated and ordinary authenticated clients.
- The ledger has a unique index on subscription + day, a claim lease, a fixed Resend idempotency key, a five-attempt retry cap, and a configurable 90-per-day account safety cap. Check the provider's current plan limits if this audience grows.
- Every email carries a manage link and a one-click unsubscribe header. The web GET unsubscribe page asks for confirmation, while an authenticated email-client one-click POST stops mail immediately.
- A person who pauses, stops, or unsubscribes retains prior readings and SOS journal entries; no marketing opt-in is implied.
- No browser-side storage of credentials. A protected cron secret authenticates the scheduler.
- If sends are delayed during downtime, the next due reading sends once; the system does not dump multiple missed days into the inbox.

## Commands

\`\`\`bash
node --test tests/daily-sos-schedule.test.mjs tests/daily-sos-email.test.mjs
\`\`\`

The GitHub Actions workflow runs the same tests. Automated passing tests do **not** replace a live controlled delivery test.

## Operational checks

\`\`\`sql
select enabled, daily_limit, max_per_run from public.sos_email_runtime where singleton=true;
select status, count(*) from public.sos_email_subscriptions group by status;
select status, count(*) from public.sos_email_deliveries group by status;
select jobname,active,schedule from cron.job where jobname='daily-sos-delivery-every-10-minutes';
\`\`\`

Do not query or display the Vault decrypted secret or the cron header secret in reports.
