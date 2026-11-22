# Multiplying Circles: one system, different purposes

Screenshots in this folder come from `scripts/e2e/circles-unified.e2e.mjs`, run against the real migrations. Phone shots are 375 and 390px wide.

## What the audit found

1. **Every Circle was a reading Circle.** `follow_circle_schedule` returned every Circle you belonged to. An outreach team still had a "Day 1 of 365", appeared as a reading choice, and could become someone's daily reading.
2. **Joining could hand over your daily reading.** The first Circle you joined became your daily reading, even if it was a Conversations group.
3. **Leaving your daily-reading Circle left you with none,** even if you were in other reading Circles. Follow Daily silently fell back to your personal pace.
4. **Follow Daily couldn't switch Circles.** The page said "Reading with X · their Day N", with no way to open another Circle's reading except changing your preference on the Circles page. Viewing and choosing were the same action.
5. **The Circles list didn't say what a Circle is.** Rows showed "Day N · Steward" only, with no purpose and no church. The Circle view showed reading controls and Conversations to every Circle.
6. **Church links lived only in Settings,** so you couldn't see which of your Circles were connected.

## The model

- **One Circle system.** A Circle is a real group. Each one chooses what it does together:
  - **FOLLOW DAILY**: the same passage each day, with reflections.
  - **Conversations**: Conversation Box steps, initials-only prayer requests and weekly huddles.
  - **Or both.**

  A steward chooses at creation and can change it in Settings.
- **One daily reading.** Only FOLLOW DAILY Circles can set it:
  - **Joining.** Your first FOLLOW DAILY Circle becomes your daily reading. Joining another Circle never replaces it.
  - **Changing.** You can choose another FOLLOW DAILY Circle or your own pace, on purpose. Choosing own pace is kept even when you join more Circles.
  - **Losing it.** If you leave or are removed from your daily-reading Circle, or that Circle turns FOLLOW DAILY off, your daily reading moves to your next FOLLOW DAILY Circle. If you have none, it becomes your own pace.
- **Viewing isn't choosing.** On Follow Daily, *Reading with: Tuesday Bible Study ▾* lists your reading Circles with their day, plus *My own pace*. Picking one opens that Circle's current reading; its calendar sets "Today". A note says *"Your daily reading is Tuesday Bible Study"* with *Back to my daily reading* and a separate *Make … my daily reading*. Your SOS answers and progress are the same whichever Circle you view.
- **Church connection is optional.** It's per Circle and never decides the reading. It shows as a small tag on that Circle in your list and in its header. It never appears in Follow Daily.

## What changed

| Where | Change |
|---|---|
| Your Circles | A "Your daily reading" line at the top. Each row shows the name, Steward, what the Circle does (FOLLOW DAILY · Day N, Conversations), "Your daily reading" and the church, and the whole row is tappable. Your daily-reading Circle is listed first. |
| A Circle | Only what applies: reading controls only for FOLLOW DAILY Circles, the Conversations tab only for Conversations Circles (a Conversations-only Circle opens on it), purpose and church tags, and a "Switch Circle" menu next to "All Circles". |
| Settings | "What you do together", editable by the steward and read-only for members. Turning something off hides it; nothing is deleted. |
| Start a Circle | Name → what you'll do together → reading start and time zone (only if FOLLOW DAILY) → create and invite. |
| Follow Daily | The Circle switcher and the "you're viewing another reading" note. Sharing a reflection while viewing a Circle starts with that Circle selected. |
| Conversation Box | Offers only Circles that use Conversations. |

## Database (`supabase/migrations/20261124090000_follow_circle_activities.sql`, additive)

- **New columns** on `follow_circles`: `uses_reading` and `uses_conversations`, both defaulting to true, so existing Circles keep everything. A check requires at least one.
- **Changed functions:**
  - `follow_circle_schedule` lists FOLLOW DAILY Circles only. Its columns are unchanged, so existing pages keep working.
  - `follow_circle_set_primary` refuses Circles that don't use FOLLOW DAILY.
  - The first-primary trigger only considers FOLLOW DAILY Circles.
- **New functions and triggers:**
  - `follow_circle_create_with` creates a Circle with its activities.
  - `follow_circle_set_activities` lets a steward change them.
  - A trigger on leaving or removal moves the daily reading to the next FOLLOW DAILY Circle. It does nothing for accounts being deleted.
  - Insert triggers refuse new reflections, steps, prayer requests and huddle goals for an activity that is off. Earlier rows are kept.
- No policy, table or row is dropped or rewritten. Every new function is revoked from `anon`.

## Privacy and isolation

Nothing new is shared:
- Viewing another Circle's reading changes only what's on screen.
- SOS answers stay private.
- Reflections, steps and prayer requests still go only to the Circles you tick.
- Church leaders still see counts only.

`scripts/circles-activities-tests.sql` checks, as real users:
- cross-Circle isolation for a member of one Circle only
- removed members, and the Conversations summary for outsiders
- that deleting an account still works

## Release order

1. Apply `20261124090000_follow_circle_activities.sql` to a test project, then to production after a backup (it builds on `20261123090000`, which is live).
2. Run Supabase's security advisors.
3. Publish the site.

Before the migration, the Circles page detects the missing columns: every Circle shows both activities, and creating uses the existing function. Follow Daily's switcher works with today's schedule function.

## Tests

- `node scripts/test-circles-unified.mjs`: static contracts.
- `psql -f scripts/circles-activities-tests.sql`: runs after the earlier Circle tests and this migration. It checks eligibility, the daily-reading rules, steward-only changes, turning activities off and on, Day 365, late joiners, isolation and account deletion.
- `node scripts/e2e/circles-unified.e2e.mjs`: real pages against the real database. It covers:
  - no Circles
  - a Conversations-only Circle
  - multiple overlapping Circles
  - viewing without changing the daily reading, and changing it on purpose
  - own pace while joining another Circle
  - turning activities off and on, and member read-only Settings
  - a church-connected and an unconnected Circle
  - leaving the daily-reading Circle
  - Day 365
  - layout at 375 and 390px
