# Growing Faith visual and navigation audit

## Purpose and information architecture

- **Growing Faith** (`/grow/`): umbrella for spiritual growth, not only intellectual exploration
- **Questions About Faith** (`/questions/`): navigate honest questions about God, belief and suffering
- **Daily SOS** (`/daily-sos.html`): cultivate daily abiding, Scripture, obedience, and sharing
- The two products remain independently accessible by their existing URLs; no redirect or data migration is required

## Design system checked against repository

| Area | Existing pattern | Growing Faith implementation | Result |
|---|---|---|---|
| Brand accent | `--ot-nav-green-deep: #00A468` in `buttons.css` | Shared token used in hub and child pages | Consistent |
| Text | Apple system/SF stack | Same stack | Consistent |
| Display type | Self-hosted Bebas Neue | Same font on hub and Questions headings | Consistent |
| Page backgrounds | Soft neutral backgrounds, white cards | `#f8f8f8` and white cards | Consistent |
| Card language | Rounded rectangles with thin gray borders | 11–16px radius, neutral borders, no heavy decoration | Consistent |
| Navigation | Homepage buttons + compact child headers | One Growing Faith parent on homepage; child links/breadcrumbs back to parent | Improved |
| Content distinction | Questions vs SOS have distinct purposes | Questions = understanding; SOS = abiding and obedience | Preserved |
| Responsive behavior | Mobile first | Two-card desktop grid, one-card mobile stack; navigation shrinks | Implemented |
| Accessibility | Links, labels, visible focus | Semantic landmarks, descriptive links, `:focus-visible`, reduced motion | Implemented |

## Changes from audit

1. Consolidated separate Questions and Daily SOS home buttons into one **Growing Faith** button without changing either destination URL.
2. Added `/grow/` hero with a two-option decision. The design does not frame SOS as merely exploring beliefs.
3. Added consistent top navigation to Questions and all nine question subpages.
4. Updated the SOS return action and desktop sidebar so the back path goes through Growing Faith.
5. Kept the original apologetics URLs and Wayback archive links, rather than replacing them with a different path hierarchy.
6. Created a small shared `grow/grow.css` token file rather than duplicating more styles.

## Important open items (not hidden)

- The apologetics article bodies and videos have **not** been recovered. Existing pages are transparently marked as incomplete.
- SOS notification delivery and syncing must be checked against the live app independently. The Growing Faith hub introduces no notification or data changes.
- Static tests confirm URL and markup presence, not actual responsive screenshots. Browser and iOS navigation QA still needs CI or hands-on review.

## QA criteria

- `/grow/`, `/questions/`, `/daily-sos.html`, and nine archived question routes resolve.
- Homepage links to `/grow/`; both cards land on their intended features.
- An individual question page has a route back to Questions and Growing Faith.
- SOS saved response storage remains unchanged.
- At 375px and 1440px, there is no unintended horizontal page overflow, trapped focus, or unreadable text.
- Each visible page can be navigated without an account.
