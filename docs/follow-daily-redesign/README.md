# FOLLOW DAILY UX redesign

Before and after screenshots live in this folder (`before-*` / `after-*`). Phone shots are 390px wide, except the `375` set. The tablet set is 820px and the desktop set is 1440px.

## What the audit found

1. **Scripture was below the first screen.** A 315px banner, a header reading "Overview / Day 1", and three task rows pushed the passage off the first phone screen. The day number appeared three times and the passage title twice.
2. **The page used tabs but looked like a journey.** READ, INSIGHT and SOS rows swapped hidden panels. Insight and SOS stayed invisible until someone tapped a row, and "Open Insight ↑" sat *below* Following Together and pointed up. That gave three competing ways to move forward.
3. **The order didn't match the journey.** In the DOM, Following Together came before Insight and SOS.
4. **Off-brand Insight styling.** Blue, orange, green and gray lens cards with borders, plus a tan "Notice the response" box, all inside a page of other boxes.
5. **SOS felt like an admin form.** Explanatory copy, a big Save button even though saving was automatic, and a Circles invite block inside the SOS panel that repeated "Manage Circles".
6. **Three admin boxes at the bottom** (sync, email signup, a fine-print notice) competed with the reading.
7. **Desktop had three columns.** A left nav and a right "daily flow" aside repeated what the page already said.
8. **Following Together read like a feed.** Every post had bordered pill buttons, Encourage gave no lasting state, and the share entry point looked like just another button.
9. **The day rail didn't show "today".** It couldn't tell today's scheduled reading apart from the selected day, and completed days used a tick that overlapped the number.
10. **The Circles page.** Its main concept, *which Circle sets my daily reading*, was hidden in About. Replies used `prompt()`. Moderation buttons (Report, Block, Delete) got the same weight as Reply.

## The redesign

- **One column in journey order:** day rail, passage title, Scripture, Insight, Respond (SOS), Following together. A slim sticky step bar (Read · Insight · SOS) shows progress and jumps to each section.
- **One primary action per section:** "Done reading · Continue", "Continue to SOS", "Finish today". Once a step is complete its button turns quiet.
- **Day rail:** compact chips centered on the current reading. *Today* is labeled in green (the primary Circle's calendar day, or your own pace). Completed days get a soft green tint and a check. When you look at an earlier day, a "Go to today" link appears.
- **Insight:** the same lens data (Revelation / Formation / Multiplication / Observe) as typographic sections in brand green, with no colored boxes. Hear / Obey / Share observations and the Consider prompt are kept.
- **SOS:** labeled "Private to you". The discovery question leads in. Fields are soft journal-style areas that grow as you type. Autosave shows a quiet "Saved". Finishing shows "Day N complete." Native share is still there as a low-key "Send to a friend".
- **Following together:** reflections show an avatar, a name and "in *Circle*". Reply and Encourage are text actions, and Encourage is a toggle with a count. Replies are inline. The compose prompt looks like a field, so it's clearly different from friends' posts. After today is complete it is highlighted and asks you to share. Circle chips must be chosen explicitly. Useful empty states cover guests, no Circles, and no reflections yet.
- **Footer:** sync and daily email collapse into two quiet rows.
- **Circles page:** a list of rows marked "Your daily reading". The daily-reading choice sits at the top of each Circle, with "Open this Circle's reading" and "Invite friends" as the main actions. Tabs are Prayer & plans / Members / Settings. Replies are inline, and moderation sits behind a ••• menu.

## Unchanged

Readings, insights, SOS meaning, storage keys, sync, RLS/schema, notifications, the Circle scheduling model (time zones, late joining, primary/independent, Day 365).
