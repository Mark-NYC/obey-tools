# FOLLOW DAILY · SOS: Insight editorial guide

## Daily UX

Three steps only: **Read · Insight · SOS**. The Scripture remains visible on-page, Insight uses scannable colored cards, and SOS keeps the existing Say, Obey, Share responses.

## Interpret Scripture before categorizing it

The goal is to see **Jesus as Scripture reveals Him**, not to squeeze every event into a leader-development framework.

1. **Revelation** (blue, clock/crown-like icon): Jesus' identity, divinity, Messiahship, divine authority, fulfillment of prophecy, prophetic role, judgment, and His unique saving work. Don't present uniquely messianic actions as things disciples should repeat.
2. **Formation** (amber, shield/check icon): How Jesus shaped faith, understanding, endurance, obedience, and character, including through hardship, suffering, correction, rejection, and unbelief. Distinguish examples from explicit commands.
3. **Multiplication** (green, people icon): Reproducible Kingdom patterns. Use **Identify**, **Equip**, **Invest**, and **Entrust** only when the passage supports those descriptions.

A passage can have one or more lenses. Every day must have a substantive, passage-specific devotional in a supported category. Never silently replace missing devotional content with a generic Observe card. The legacy reading plan's phase value must NOT automatically determine a lens. Hear · Obey · Share is a separate, selective response observation and never replaces the theological Insight.

## Recommended card anatomy

- Colored icon and uppercase lens name
- A compelling, concrete headline
- 50–90 words explaining what the text establishes, with proper theological distinctions
- Multiplication pattern chip only when directly warranted
- One **Consider & Respond** application tied to the passage
- Avoid treating every event as a transferable method

Write in everyday language suitable for a college student. Favor textual specificity, humility about inferences, and one memorable insight over generic commentary.

## Content and release requirements

All 365 readings now have individually authored draft cards in `daily-sos-insights-first30.js` and the four `daily-sos-insights-days*.js` files. This is a complete **draft coverage pass**, not a claim that 365 interpretations have completed theological or in-browser review. Every card still needs editorial verification against its full passage before the plan is considered fully reviewed. Keep the response observation panel distinct from Insight.

**Do not release the three-step change until:**
- The authored 365-reading Insight corpus receives theological editorial review.
- Keep the deployed Supabase `insight` field whitelist and independent sync adapter working without altering existing user rows or field revisions.
- Browser checks confirm Read → Insight → SOS, direct day links, scrolling day rail centering, offline storage, draft saving, and signed-in cross-device progress.
- Mobile and desktop layouts and keyboard access have been checked.

Existing SOS responses must never be overwritten or reset.
