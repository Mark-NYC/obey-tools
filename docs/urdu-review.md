# Urdu release and disciple-maker review

Status: implemented; interface translation is a first draft awaiting native-speaker review. Scripture is published Bible text, not machine-translated Scripture.

## Try it

After this branch is deployed, open `https://obey.tools/?lang=ur`. Urdu is also in the homepage language dropdown. The preference persists between pages. Any page accepts `?lang=ur`; `?lang=en` switches back. Redirects retain the language query.

Use a fresh test account for account and leader workflows. Do not reset real ministry records while testing.

## Bible choice

**Biblica® Open Urdu Contemporary Version™ (2024), OUCV**, in Urdu script. This contemporary translation is distributed under CC BY-SA 4.0, allowing local display and redistribution with attribution. This is a practical starting choice for discovery studies; the Urdu-speaking disciple-maker should assess its vocabulary for the intended audience.

- Publisher: https://preview.open.bible/bibles/Urdu-Biblica-Bible-Text
- Copyright and terms: https://ebible.org/urdoucv/copyright.htm
- Official distribution: https://v1.fetch.bible/manifest.json (`urd_bib`)
- Local source data: `assets/bible/ur-oucv.json`
- Visible attribution (expand for the full notice): every embedded passage, Church Circle, and `bible-copyright.html`

Published text is imported with its notes. In this translation, some familiar words differ from common church usage, notably **پاک غُسل** for baptism and **پاک رُوح** for the Holy Spirit. Notes explain terminology. The interface uses **بپتسمہ** and **روح القدس**. Review this distinction explicitly; do not silently rewrite a published Bible translation to match interface labels.

The dataset includes Matthew, Mark, Luke, John, Acts, and Hebrews. This covers every embedded study passage, the Church Circle presentation, the command references, and all 60 daily Mark readings. Notes and verses omitted in some textual traditions come from the source edition; no verse is invented or copied from another edition.

## Coverage

- All user-facing source pages, including the extensionless legacy `uco` page.
- Navigation, account controls, password reset, errors, placeholders, document titles, accessible names, and descriptions.
- Conversation Box, its four spatial stages, onboarding, and sharing.
- Stories of Hope, Commands of Christ, Signs of John, the story selector, 4-1-1, Church Circle, leader tools, progress pages, Band, and UCO.
- 28 embedded Bible blocks, including the live-facilitation test page.
- Local Scripture reader and the daily Mark reading links.
- Three Circles automatically uses the existing Urdu video; other language choices remain available.
- The guide page provides an Urdu print/PDF view rather than downloading the original English PNG in Urdu mode.

External websites and third-party videos are not translated by this feature. Urdu story-selector links point to local Urdu studies instead of English Google Forms. The fear/provision selection opens Matthew 6:25–34 in the local Urdu reader. International language names, brands, user-entered names, and published copyright notices intentionally retain their originals.

## Native review checklist

1. Choose Urdu on the homepage. Navigate away, reload, then switch back to English. Confirm Urdu reads naturally on iPhone Safari and Android Chrome.
2. Walk through Conversation Box without using full real names. Confirm the four stages, arrows, clockwise movement, onboarding, editing, sharing, and saved progress make sense. Language switching must not lose progress.
3. Complete a Commands study and a Stories study. Open the Bible, expand its notes, mark steps complete, and reload. Check the distinction between obeying and sharing goals.
4. Read a whole OUCV passage aloud. Assess whether a new Urdu reader can understand it. Compare selected verses and notes with the published source linked above.
5. Open all five 4-1-1 tabs in portrait and landscape. Check connected letters, diagram labels, Oikos map, personal story, and wordless Three Circles artwork. Spatial diagrams deliberately keep their teaching coordinates.
6. Run all 12 Church Circle presentation steps. Verify each highlighted phrase is part of the displayed verse, and assessment/share views fit on screen. Urdu Play advances silently, matching the existing non-English behavior.
7. Search the Urdu story selector, open a match, and copy its link and message. Both should lead to Urdu content.
8. Open the daily Mark reading and several entries in the 60-reading list. All Urdu links should display the intended Urdu verses on the site. Check Mark 16 notes.
9. Print the Urdu Conversation Box guide or save it as PDF. Confirm legibility and useful wording.
10. On a test account, check account registration, password reset, invitations, leader lists, Band, and UCO. Verify names and saved keys are preserved.

Record feedback as: page URL, exact phrase, proposed wording, screenshot if a layout problem. Prioritize clarity for new disciples over formal vocabulary.

## Vocabulary to settle

| Concept | Draft interface wording |
| --- | --- |
| Disciple | شاگرد |
| Make disciples | شاگرد بنائیں |
| Church | کلیسیا |
| Repent and believe | توبہ کریں اور ایمان لائیں |
| Baptism | بپتسمہ |
| Holy Spirit | روح القدس |
| Obey / obedience | عمل کریں / فرمانبرداری |
| Follow / Fish | پیروی / خوش خبری |
| Discovery | کلام کی دریافت |
| Loving accountability | محبت بھرا احتساب |

## Maintenance

Edit `lang/ur.json` for language feedback. `site_text` contains stable IDs for previously unlocalized source text, and `lang/ur-text-index.json` maps its English source strings to translation keys. Existing database values, user-entered text, and progress keys are not translated.

`scripts/import-urdu-bible.py` imports the published Scripture dataset and fills the Church Circle verses and exact highlight phrases. The importer uses Python's standard library, stores upstream URLs/checksums, and fails on unexpected source structures. Review upstream changes and keep all highlight phrases exact. Imported Scripture stays under CC BY-SA 4.0, separately from interface code.

Self-hosted Noto Naskh Arabic is licensed under SIL OFL; its license is alongside the font. It supports joining Urdu text and avoids dependence on a visitor's installed Arabic fonts.

## Verification

`tests/i18n/run.cjs` checks translation-key and array parity, placeholders, source-passage coverage, exact Church Circle highlights, browser initialization across all pages, mobile layout, study interactions, the local reader, selector links, preference persistence, and English regression behavior. Backend requests are mocked; these checks do not claim to validate a real production sign-in or write ministry records.

The existing Band persistence/concurrency suite and live-facilitation suite also run against their local mocks. Native-speaker approval and real-device Safari testing remain the next review steps.
