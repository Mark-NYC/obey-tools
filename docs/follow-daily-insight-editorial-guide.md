# FOLLOW DAILY · SOS: Insight editorial guide

## Daily UX

Three steps only: **Read · Insight · SOS**. The Scripture remains visible on-page, Insight uses scannable colored cards, and SOS keeps the existing Say, Obey, Share responses.

## Interpret Scripture before categorizing it

The goal is to see **Jesus as Scripture reveals Him**, not to squeeze every event into a leader-development framework.

1. **Revelation** (blue, clock/crown-like icon): Jesus' identity, divinity, Messiahship, divine authority, fulfillment of prophecy, prophetic role, judgment, and His unique saving work. Don't present uniquely messianic actions as things disciples should repeat.
2. **Formation** (amber, shield/check icon): How Jesus shaped faith, understanding, endurance, obedience, and character, including through hardship, suffering, correction, rejection, and unbelief. Distinguish examples from explicit commands.
3. **Multiplication** (green, people icon): Reproducible Kingdom patterns. Use **Identify**, **Equip**, **Invest**, and **Entrust** only when the passage supports those descriptions.

A passage can have one or more lenses. Some passages call for no such label, in which case use a neutral observation guide until a specific Insight is authored. The legacy reading plan's phase value must NOT automatically determine a lens.

## Recommended card anatomy

- Colored icon and uppercase lens name
- A compelling, concrete headline
- 50–90 words explaining what the text establishes, with proper theological distinctions
- Multiplication pattern chip only when directly warranted
- One **Consider & Respond** application tied to the passage
- Avoid treating every event as a transferable method

Write in everyday language suitable for a college student. Favor textual specificity, humility about inferences, and one memorable insight over generic commentary.

## Content and release requirements

The first curated entries are in `daily-sos.html`. All remaining readings currently show a **neutral reflection guide**, not a finished devotional. They must be authored and reviewed individually against the full Scripture.

**Do not release the three-step change until:**
- The curated Insight corpus covers all 365 readings with theological editorial review.
- The Supabase `sos_merge_progress` field whitelist permits `insight` and the sync adapter persists this field as independent progress. Keep existing user rows and field revisions intact.
- Browser checks confirm Read → Insight → SOS, direct day links, scrolling day rail centering, offline storage, draft saving, and signed-in cross-device progress.
- Mobile and desktop layouts and keyboard access have been checked.

Existing SOS responses must never be overwritten or reset.
