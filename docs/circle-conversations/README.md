# Conversation Box × Circles, and church view

Groups share an outreach rhythm without sharing anyone's name. Screenshots in this folder come from the end-to-end run against a real database.

## What people see

- **Conversation Box** (only for signed-in members of a Circle):
  - **Bottom bar, not a pop-up.** After you add someone or move them forward, a dark bar names the step and offers one tap to share it with your Circle: stage only, never the name (`mobile-share-bar.jpg`). It closes itself after 6 seconds and pauses while you touch it. Moving someone back never asks. In safety mode it never appears.
  - **This week.** Turn on "Focus on … this week" in a person's sheet, or pick people in the Circle huddle. Those rows carry a green flag that turns into "Moved this week" once you move them, and a card under the title shows "This week · 1 of 2 moved forward" (`mobile-box-week.jpg`). The Circle sees only the number.
  - **Ask the group to pray.** It's in the person sheet, with initials prefilled and the next step as the line (`mobile-person-pray.jpg`). Once people pray, the row shows "4 praying" on your device only.
  - A **Your Circles** link sits in the footer.
- **Circle › Conversations tab** (`mobile-circle-conversations.jpg`):
  - **Our Conversation Box.** Clockwise totals with "+N this week", counting members who chose *Include my numbers*.
  - **Pray for.** Initials-only requests with a Praying toggle, Report and Delete.
  - **This week.** Who moved people forward, as stages only.
  - **Weekly huddle.** *Your week* from this device, and *Who will you move forward?*, picked from your own box. The group sees the number you commit to, not who.
- **Circle › Settings**: *Include my Conversation Box numbers*, and the church this Circle is linked to (stewards can unlink).
- **Church view** (`/church.html`, `desktop-church-view.jpg`):
  - A leader creates a church view and sends a **Circle link** to each group steward. The steward chooses which of their Circles to link.
  - Leaders see totals by stage, steps and "trusted Christ" over 30 days, a per-Circle table with the last huddle, and "Worth a nudge" prompts (no huddle in two weeks, low opt-in, many in Spiritual but few in Discovery).
  - An **Add a church leader** link adds co-leaders.

## Privacy model

| Data | Who can see it |
|---|---|
| Names in your Conversation Box | Only you (your account, as before) |
| Your box totals by stage | Your Circle, after you opt in. Church leaders as part of each Circle's totals |
| A step you share (from → to stage, Discovery response, time) | That Circle's members (except anyone who hid you). Church leaders as counts |
| Prayer request (initials, stage, one line) | That Circle's members. Never church leaders |
| Huddle goal (a number) | Only you, plus the Circle's sum. Names you pick stay on this device |
| Circle posts, members, reading progress | Unchanged. Church leaders never see them |

The database enforces this:
- **Initials format.** Full names are rejected for prayer requests.
- **Steps are forward-only and insert-only.** No one can read the table directly; the summary and activity functions return counts.
- **Church functions are admin-only and return counts.**
- **Members who leave or are removed drop out of every count.**
- **Every new function is revoked from `anon`.**

## Release order

1. Apply `supabase/migrations/20261123090000_follow_circle_conversations.sql` to a test project or branch, then production, after a backup. It only adds tables, columns and functions. It also reads `public.conversation_people` (`user_id`, `box_name`), which must exist.
2. Run the database security advisors.
3. Publish the site. Until the migration is live, Circles hides the Conversations tab and church links (feature detection). Conversation Box only offers sharing to people whose Circle membership loads.

## Tests

```bash
node scripts/test-circle-conversations.mjs   # static contracts
```

```bash
# Ephemeral database, after the earlier Circle migrations and tests:
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261123090000_follow_circle_conversations.sql
psql -v ON_ERROR_STOP=1 -f scripts/circles-conversations-tests.sql
```

```bash
# Real pages against an EMPTY throwaway database (PG* env vars), Playwright installed:
node scripts/e2e/circle-conversations.e2e.mjs shots/
```

The end-to-end run drives the real sequence:
1. Alice starts a Circle; Bob joins by link.
2. Alice moves people forward in Conversation Box and shares a step and a prayer request.
3. Alice opts in; Bob sees totals, activity and the request, prays, and commits in the huddle.
4. Dana creates a church; Alice links the Circle; Dana sees counts.

It asserts that no names from Alice's box reach Bob or Dana. `scripts/e2e/pg-bridge.mjs` stands in for PostgREST: it turns each supabase-js call into SQL run as the signed-in user, with RLS on. It is test-only.

## Not included yet

- Email or weekly digests for prayer requests and huddles. The Circle email worker is still disabled.
- Renaming a church.
- Translating the Circles and church pages. They are English, like the rest of Circles. Conversation Box's new strings are in English and Urdu.
