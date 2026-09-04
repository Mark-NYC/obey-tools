# Media to Multipliers CRM (Google Sheets + Apps Script)

A lightweight, mobile-friendly CRM that lives entirely inside one Google Sheet.
No Make, Zapier, ManyChat, Airtable, or external database. Google Sheets is the
only daily interface the team touches.

**Pathway it tracks:** Facebook ad → Messenger conversation → Messenger Bible
story group → video call → Stories of Hope / Discovery Bible Study → obedience
and sharing → emerging leader → new group.

**Principle:** local ownership. AI (Claude) may summarize and draft, but the
assigned local engager always decides and sends. Nothing pastoral is automated.

## Files

| File | Purpose | Milestone |
|------|---------|-----------|
| `Config.gs` | Tab names, column layouts, dropdown lists, helpers, logging | 1 |
| `Menu.gs` | The "Media to Multipliers" custom menu (`onOpen`) | 1 |
| `Setup.gs` | Builds/repairs all tabs, formatting, validations, triggers | 1 |
| `Stubs.gs` | Temporary placeholders replaced by later milestones | 1 |
| `Claude.gs` | Anthropic Messages API integration | 2 (later) |
| `Webhook.gs` | Meta Messenger `doGet`/`doPost` | 3 (later) |
| `Views.gs` | TODAY + DASHBOARD calculations | 4 (later) |

## Tabs it creates

TODAY, PEOPLE, ACTIVITY, GROUPS, ENGAGEMENT, DASHBOARD, SETTINGS, SYSTEM LOG.

## Secrets (never in cells or code)

Set these in **Project Settings → Script Properties**:

- `ANTHROPIC_API_KEY`
- `CLAUDE_MODEL`
- `META_VERIFY_TOKEN`
- `META_PAGE_ACCESS_TOKEN`
- `META_PAGE_ID`

## Milestone 1 setup

1. Create a new Google Sheet.
2. **Extensions → Apps Script**.
3. Delete the default `Code.gs`.
4. Add four script files (the **+ → Script**), named exactly:
   `Config`, `Menu`, `Setup`, `Stubs`. Paste each file's contents.
5. Save. Reload the Google Sheet.
6. Menu **Media to Multipliers → Set Up / Repair Workbook**. Authorize when asked.
7. Open **SETTINGS**, replace the placeholder owners with your real team names.

Re-running "Set Up / Repair Workbook" is safe — it never deletes your data.
