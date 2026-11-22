# Conversation Box UX redesign

Before and after screenshots live in this folder (`before-*` / `after-*`). Phone shots are 390px wide, except the `375` set. The tablet set is 820px and the desktop set is 1440px.

## What the audit found

1. **No identity or starting point.** The page opened with a large Home pill and a gray sentence. It never said "Conversation Box" and never showed the order of the stages.
2. **The first phone screen looked disabled.** Empty stages auto-collapsed into four gray bars marked `0 ▸`. That also hid the only first-run hint ("Start by adding one person…").
3. **Direction was unclear and sometimes wrong.** Rows used bare `→ ← ↓ ↑` glyphs. On desktop, the Discovery row's forward-styled `→` actually moved people *back* to Spiritual, and Spiritual's `←` moved people *forward*. Nothing showed that the quadrant runs clockwise.
4. **Two or three round buttons per row.** Forward, back and a red delete were the same size and next to each other, so a hurried tap could remove someone. A name containing an apostrophe (`O'Brien`) broke every row button, because names were inlined into `onclick` strings.
5. **Names gave no hint that they open details.** The only clue was an unlabeled gray dot. The saved next step was never shown.
6. **Reset sat next to Share.** It had the same weight as the main secondary action. View Map had a different, bordered style.
7. **Dialogs were inconsistent.** Some had no backdrop. Yes/No buttons were stacked 100px buttons in red and gray. The stage picker was a plain text list with no context, and the response picker used `+` glyphs.
8. **Desktop dead space.** The add field was pinned below a tall empty area at the bottom of the card. Gray, uppercase stage titles competed with nothing.
9. **Emoji glyphs** appeared in onboarding hints (🔒 ↻) and map toasts (🌍 📍).

## The redesign

- **Header:** a compact Home pill, the CONVERSATION BOX title in the site's Bebas style, and the existing one-line explainer.
- **Stages are numbered 1 to 4 everywhere** (Casual, Meaningful, Spiritual, Discovery): in the board, the add-person picker and the details sheet.
- **Direction of travel is explicit.**
  - *Phones:* stages stack and people move **down**. Forward buttons point down, and a ↓ connector sits between stages.
  - *Tablet and desktop:* the quadrant runs **clockwise** and ends in Discovery. Connectors sit in the gaps (→ between 1 and 2, ↓ between 2 and 3, ← between 3 and 4), and each row's forward button points the same way. The layout mirrors correctly in RTL.
- **One action per row:** a green pill naming the next stage ("Meaningful →"). Spiritual → Discovery still asks for the response (Rejected / Open / Trusted / Existing), exactly as before.
- **Secondary actions moved into the details sheet** (tap the name): "Back to {stage}" (its arrow points the reverse way) and Remove, which still uses the same confirmation. Rows show the saved next step under the name.
- **Phones:** an overview strip shows each stage's count and jumps to that stage. It is hidden until there is someone to show. The add bar stays at the bottom for thumb reach, and the pickers open as bottom sheets.
- **Desktop:** the add field sits at the top of the board.
- **Footer:** Share and View Map are equal secondary buttons. "How it works" and Reset are quiet text actions.
- **Dialogs:** one look, with a scrim, No/Yes side by side, Escape to close, and focus moved into the dialog.
- **Icons:** SVG icons replace the emoji. Translation strings are unchanged; the leading symbol is stripped at render time.

## Unchanged

The four stages and their order, the Discovery response options and colors, every wording and translation, storage keys, data shape, Supabase sync and merge, map events and location prompts, green-light tracking, the share-image capture, onboarding steps, and safety mode.

New strings: `choose_box_title`, `move_to`, `move_back_to` and `remove_btn`, in English and Urdu. Other languages fall back to English for these four.
