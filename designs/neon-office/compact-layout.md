# Compact layout

Default sizing for the Neon UI. The goal is to show more work at desktop scale while keeping conversation text
readable. The app's Neon skin and Office implement this sizing; the original HTML preview keeps its reference geometry.

## Desktop dimensions

| Surface | Default | Behavior |
|---|---:|---|
| Sidebar | 240px | Resizable 220–320px; preserve a width the person already saved |
| Sidebar row | 32px minimum | Two-line rows grow with their text |
| App / chat header | 44px minimum | Grow when titles or controls wrap |
| Room / bot detail panel | 320px | Overlay when keeping it inline would leave chat narrower than 600px |
| Goal detail panel | 360px | Overlay on smaller layouts; full width on a phone |
| Office HUD rail | 320px | Beside the scene only when the Office content area is at least 1100px wide |
| Office stage | 760px minimum beside rail | Below 1100px content width, put the rail below the scene |
| Office on a phone | Room list | Below 640px content width, replace the isometric scene with room cards |
| Office outer gutter | 12px | Respect safe-area insets |
| Panel padding / panel gap | 12px / 12px | No nested decorative panels |
| Panel setting row | 36px minimum | Hints, validation and multiline fields grow naturally |
| Input / select / action button | 32px minimum | Labels fit without vertical clipping |
| Icon button | 28px minimum | 16px icon and a visible focus outline |
| Bot avatar in sidebar / status | 24px | Keep the scene core at its existing r10; do not scale down scene labels |
| Chat composer | 44px minimum | Grow with text; keep send, attach and Stop reachable |
| Chat column | 880px maximum | Center in spare space; retain the existing wide/full preference |

Use the available **content** width for Office breakpoints, after the sidebar, window rail, page gutters and open panels have
taken their space. A 1366px screen with a 240px sidebar and 24px gutters, without another window rail, leaves enough width for the scene and HUD; a smaller
content area stacks them. Do not shrink the entire canvas to squeeze both columns into a narrow pane.

## Typography

| Use | Size / line height |
|---|---|
| Screen title | 24px / 1.15 |
| Section heading / room name | 13px / 1.35 |
| Controls, sidebar and task titles | 13px / 1.4 |
| Conversation text | 14px / 1.55 |
| Secondary description | 12px / 1.45 |
| Paths, models, counters | 11.5px / 1.4, mono |
| Scene bot name / scene state tag | Keep 11px / 10px |

Do not reduce body text below these values to fit a panel. Wrap descriptions; truncate only short repeated labels
such as a sidebar title, and expose the full value on focus or in its detail panel. Full model IDs, errors, numeric
metrics and paths must be readable in their detail views. Do not use condensed letter spacing on Vietnamese text.

## Chat and content

- Message bubble padding: 10px vertically and 12px horizontally; message gap 12px, paragraph gap 8px.
- Keep text, code and tables scrollable inside their own containers; do not make the whole app scroll sideways.
- A goal card shows the goal, state, turn count and check summaries. Put the task table and usage breakdown in its panel.
- Office cards show a short current task. Put full output and logs in the existing conversation or goal panel.
- Do not leave an empty hero region above Office or Team status. Titles align with the useful content below them.

## Touch and accessibility

- On coarse pointers, interactive targets are at least 44×44px; visual icons can remain 16–18px.
- On phones, editable text inputs use at least 16px text to avoid browser focus zoom.
- Minimum heights grow for browser text enlargement. No fixed row height with hidden overflow on multiline content.
- At 200% browser zoom, navigation and detail panels collapse or overlay rather than obscuring the main controls.
- Preserve keyboard focus, contrast and reduced-motion behavior. Compact sizing never removes action labels or errors.

## Integration rules

- Apply the new default density with Neon. Existing skins keep their spacing unless the person explicitly chooses
  the new density. Do not overwrite saved sidebar width, skin or chat-width choices.
- Use layout/type tokens and shared components. No global CSS `zoom`, root transform or blanket reduction of every
  `rem`: those also shrink text, dialogs and interaction targets.
- Compact and comfortable sidebar row preferences already exist; reuse them rather than add a second density system.
- Reference dimensions live in `project/tokens.json` and `project/tokens.css`; this document defines responsive behavior.
  CSS retains the reference preview's typography by default; `[data-density="compact"]` opts into the new type sizes.

## Acceptance

Check 1920×1080, 1440×900, 1366×768 and 1280×720 desktop windows, plus 390×844 touch. At 1366×768 without an extra
window rail, Office shows the scene and 320px rail beside the 240px sidebar. With extra chrome, stack when the
inner content area falls below 1100px. Chat can keep a 320px detail panel if at least 600px remains.
At 1280×720, collapse or overlay panels as needed; do not reduce fonts to retain columns. At 390×844, show a room
list, an accessible navigation drawer and full-width detail sheets. Repeat navigation and primary actions with
200% browser zoom and keyboard only. Record actual element bounds and overflow, not just screenshots.
