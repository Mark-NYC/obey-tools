# FOLLOW DAILY: engagement refinements

This builds on the UX redesign (`docs/follow-daily-redesign/`). The principle is to **enhance what people already do and never add tasks**. The core activities are still only these: read, discover the Insight, respond through Say / Obey / Share, and encourage one another.

The screenshots in this folder use seeded data: a Circle member on Day 12 who has completed 6 readings, made a commitment on Day 9, and has been away for 5 days.

## Audit: where engagement leaked

| Moment | Before | Problem |
|---|---|---|
| Returning after days away | The page opened on the Circle's day with no acknowledgement | It felt like nothing noticed you were gone, and the old guilt risk remained if we had added counts |
| Progress | "3 of 365 days completed" in tiny footer text | How far you'd come was invisible, and milestones didn't exist |
| Completing a day | One line of text: "Day N complete. Well done." | No sense of arrival. It said the same thing every time, and repeated when reopening a completed day |
| OBEY follow-up | Only shown if the *immediately previous* day had an Obey answer, and placed under the day's question | One missed day hid the commitment. It read as a form row rather than a bridge from yesterday to today |
| Friends | Reflections were visible only after scrolling past Scripture, Insight and SOS | Nothing at the top said friends were there |
| Encouraging | A heart with a number | The number reads as a score, and authors never learned *who* encouraged them |
| Replying | A notice appeared at the top of the section | The confirmation was far from where you typed |
| New reflections | All looked the same | No way to notice a friend's new post |
| Week | Nothing | No way to look back on what you read or planned to do |
| Inviting | Only from the Circles page | No natural moment to ask "who could join me?" |

## What changed, and where it lives

None of these add a step. Everything sits inside an existing element.

1. **Your journey.** A small progress ring sits in the day header ("6 of 365"). Tapping it opens *Your journey*:
   - a 365-cell map showing completed, started, and your Circle's day;
   - milestones at 7, 30, 90, 180 and 365 completed readings;
   - your week.

   Milestones count completed readings, so a missed day can never take one away. Earned milestones are also stored, so they survive even if answers are cleared. The day rail still scrolls and keeps its "Today" and completed states.
2. **Friends are here.** One compact line under the passage title, such as "Maya and Chris reflected on this passage". It shows only when real members of your Circles have posted on this passage, and it's scoped by the existing RLS. Tapping it scrolls to Following together. It never implies anyone is online. In Following together, a friend's reflection you haven't seen on this device gets a small "New" tag.
3. **Small celebrations.** When a day actually becomes complete, the finish feedback shows a drawn check, the real count ("That's 13 readings so far"), and, only at a milestone, a short line plus *Who could you begin following Jesus with?* There is no confetti. Reduced-motion turns off all animation. Reopening a completed day, or a day completed on another device, never re-celebrates.
4. **Remember what you committed to.** The commitment now leads the Respond section, before today's question, so yesterday's step meets today's Scripture. It looks back up to 7 readings, so a missed day doesn't hide it. It is labeled by day and passage ("On Day 9, you planned to… From Luke 1:57–66"). The three response options are unchanged, optional, and saved on the day the commitment was made, preserving history. Gentle acknowledgements include "That's okay. It's still yours to carry into today."
5. **Encourage a friend.** Encouragement shows *who*, not a count:
   - "Encouraged by Sam" on a friend's post;
   - "Maya encouraged your reflection" on your own post, where the Encourage button is hidden.

   The heart gives a small pulse. A sent reply is highlighted in place, with "Reply sent to Chris in Campus Fellowship." right under the reply box.
6. **Your week.** This is inside *Your journey* and is never pushed. It shows readings completed in the last seven days and what you planned to put into practice, with your own saved responses. It uses the per-field revision timestamps the sync layer already stores. Bulk imports, such as the first sign-in upload, are excluded, so it never claims old work happened this week. It is private to the device and account, and nothing is interpreted.
7. **Start another Circle.** The prompt appears only at milestone celebrations, in *Your journey*, and on the Circles page. `follow-circles.html?new=1` opens *Start a Circle* directly. The dialog notes that another Circle never adds a second daily reading.
8. **Returning after time away.** One line, shown only after 3 or more days away and only on today's reading: "Welcome back. Start right here with your Circle." Missed days are never counted.

## Deliberately not built

- XP, points, streaks, leaderboards, reaction counts, unlocks.
- A mission, challenge, extra Obey assignment, or new journal field.
- Weekly reviews that are required, notifications, banners, popups, or a new feed.
- Any database change. Everything uses existing tables and policies plus localStorage.

## Measuring success (privacy-respecting, aggregate only)

The daily page has no analytics script, and this change does not add one: it is a private journaling page. Success can be measured from tables that already exist. The queries below return **counts only, never content**, and should be run with the service role by the project owner.

```sql
-- Returning at 7 and 30 days: accounts whose first and latest activity are at least N days apart.
with spans as (
  select user_id, min(saved_at) first_at, max(saved_at) last_at
  from public.sos_daily_progress where field_name <> 'cursor' group by user_id)
select count(*) filter (where last_at - first_at >= interval '7 days')  as returned_after_7,
       count(*) filter (where last_at - first_at >= interval '30 days') as returned_after_30,
       count(*) as accounts
from spans;

-- Completion and continued participation: distinct readers per week who saved a Share answer
-- (the last SOS field).
select date_trunc('week', saved_at) week, count(distinct user_id) readers
from public.sos_daily_progress where field_name = 'share' group by 1 order by 1;

-- Revisiting commitments: people responding to an earlier Obey (the 'check' field).
select date_trunc('week', saved_at) week, count(distinct user_id) people
from public.sos_daily_progress where field_name = 'check' group by 1 order by 1;

-- Encouragement and conversation: replies and encouragements per week (no content).
select date_trunc('week', created_at) week,
       count(*) filter (where parent_id is not null) replies,
       count(*) filter (where parent_id is null) reflections
from public.follow_circle_posts group by 1 order by 1;
select date_trunc('week', created_at) week, count(*) encouragements
from public.follow_circle_reactions group by 1 order by 1;

-- Inviting others: new Circles per week, and members who joined an existing Circle.
select date_trunc('week', created_at) week, count(*) new_circles from public.follow_circles group by 1 order by 1;
select date_trunc('week', joined_at) week, count(*) joins from public.follow_circle_members group by 1 order by 1;
```

Screen time, raw clicks and interaction totals are intentionally **not** success metrics.
