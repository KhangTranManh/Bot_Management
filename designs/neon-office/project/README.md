Neon Office is the look of the team office in Bot Management: every room as a glowing isometric platform around the Chief of Staff, every bot at its own desk, and a HUD rail of goals, waits and events beside it. A night scene with a light cyberpunk edge: violet-black surfaces, neon that always means something, cut corners instead of round ones.

The full reference screen is `office-preview.html` beside this `project/` folder; it loads `tokens.css` and `components/bundle.css` from here and adds nothing of its own except page layout.

The app implementation uses the [Compact layout definition](../compact-layout.md). Its dimensions supersede the
original preview's 340px rail, 14px panel padding and 26px title; the HTML preview has not been resized yet.

## Content fundamentals

- Write UI copy in Vietnamese, plainly, from the person's side: *Cần bạn*, *Luồng công việc*, *Vừa xảy ra*, *Bot đang chọn*.
- Keep the app's own English terms where the app uses them: roles (*Lead*, *Worker*, *Tester*, *Reviewer*, *Chief of Staff*), room kinds (*code*, *research*, *chat*), *goal*, *task*, *verify*, *writes*, *PASS*/*FAIL*.
- Every count carries its limit: *lượt 6/13*, *task 4/6*, *vòng sửa 1/3*, *verify 1/2 đạt*, *GPU 2.0/12 h*. Set them in the `data` style.
- State words are fixed: *đang xử lý*, *xếp hàng*, *chờ bạn*, *hết lượt*, *rảnh*. Do not invent synonyms.
- Action buttons are one verb: *Mở*, *Duyệt*, *Xem*.
- No emoji, no exclamation marks, no "AI is thinking" filler. Mark sample content with a `Dữ liệu mẫu` tag; never present invented bots or numbers as real.

## Color

- Ground the page in `void`; draw the scene floor in `floor`; set rail blocks on `panel`; raise desk tops and hovered rows to `panel-raised`.
- Draw hairlines, panel borders, the floor grid and empty progress in `line`; control outlines at rest in `line-strong`.
- Primary text is `fg`, secondary text `muted`. Text on any neon fill is `on-neon`.
- Room kind owns the room's hue and nothing else does: `cyan` for code, `acid` for research, `violet` for chat. Apply it with the `k-code` / `k-research` / `k-chat` class, which sets `--room`.
- Bot state owns five hues: `run`, `queue`, `wait`, `out`, `idle`. Apply them only with `is-running` / `is-queued` / `is-waiting` / `is-out` / `is-idle`, which set `--s`.
- `magenta` is the brand neon: the Chief's hub, selection, keyboard focus, the start of a hand-off beam, panel corner brackets and the `//` before a panel heading. It never marks a state or a room kind.
- `wait` is also the fill of every button that answers something waiting for the person, and of nothing else.
- One theme only (`dark`). Do not add a light variant; the scene is a night office.

## Type

- Three families, all from Google Fonts with the Vietnamese subset (loaded by `bundle.css`): `display` (Chakra Petch), `body` (Be Vietnam Pro), `mono` (JetBrains Mono).
- `title`: the screen name, 24px, uppercase, once per screen, with `no-chromatic` (a 1px `magenta`/`cyan` split).
- `room`: room names. `label`: panel headings and floor lettering, uppercase with wide tracking.
- `body` (13px) for controls and task names; conversation text stays 14px. `body-sm` (12px) for rows inside panels; `name-tag` for bot names in the scene.
- `data` for every number, path, command, model id and hash, with tabular figures. `data-xs` for state words and tags, uppercase.
- Nothing is set below 9.5px (role text inside a name tag); nothing in the rail below 10px.

## Spacing, shape and depth

- Gutter: `space-4` on each side, as `max(var(--space-4), env(safe-area-inset-*))`.
- Between stage and rail and between panels: `space-3.5`. Panel padding `space-3.5`; inside a panel `space-2.5`; between goal rows `space-2`; between chips `space-1.5`.
- Corners are cut, not rounded. Panels and the stage take `no-notch` (`notch-md`, top-right and bottom-left). Buttons and goal rows cut `notch-sm`. Name tags, bubbles and tags keep `radius-xs`; filter chips `radius-sm`; only dots and bot cores are round (`radius-dot`).
- Depth is light, not elevation: `panel-depth` under panels and the stage; `glow-magenta` on selection and focus; `glow-cyan` on the pressed filter; `glow-wait` on wait buttons. A state dot glows in its own state color.
- Add `no-scanlines` once, to the outermost wrapper. Its strength is `opacity-scanline`; do not raise it.

## Motion

- Five motions only: the hand-off ticket flying once from the one who hands the work on to the one who takes it (`office-hop`, 1.1s, only when a bot takes a job after the first poll), the halo pulse of a running bot and the Chief's inner ring (`no-pulse`, 2.4s), the Chief's dashed ring turning (`no-spin`, 18s), and the mascots' own faces. Plus the cursor after `SYS://online`.
- There are no lines or arrows between bots. Roles are floor zones (Lead, Workers, Kiểm tra, left to right); who gave work to whom is a ticket in the air, then a paper on the receiver's desk. At rest nothing flows.
- A running bot's desk screen glows; a queued bot has a stack of faded papers. A small round badge beside each busy bot's head says what its face means (thinking, reading, writing, running a command, receiving, handing in, queued, failed step, drowsy, asleep, waiting for you, out of usage, goal done); an idle bot has none. Faces and badges are held at least 1.5s so a 5s poll never flickers.
- Nothing else moves: no hover animations on panels, no page-load sequence, no glitch.
- Under `prefers-reduced-motion: reduce` every one of them stops: no ticket flies (the paper is simply on the desk) and the mascots are not animated.


## The isometric scene

- One projection for everything, unit `iso-unit` (26px): screen x = (x − y) × 26 × 0.866, screen y = (x + y) × 13 − z × 26.
- The Chief's hub is at world (0, 0). Rooms sit around it as rectangles in world units: one up (both negative), one left (x − y negative), one right (x − y positive), one down (both positive). Keep a gap of at least 3 units between platforms.
- A platform is `iso-platform` thick; desks are `iso-desk`; seats fill a 2-column grid, 3 columns past four members, and are drawn back to front by x + y.
- Order of layers: floor grid (every 2 units, `major` lines every 10), platforms with their zones, desks and bots, tickets in the air, the hub on top.
- The page supplies three SVG defs used by the classes: filters `#no-soft` (blur 4) and `#no-bloom`, and the `#no-beam` gradient from `magenta` to `cyan`. Copy them from `office-preview.html`.
- The SVG keeps its `viewBox` and sits in an `overflow-x: auto` box with `min-width: 760px`; the page itself never scrolls sideways.
- Filtering dims rooms and beams to `opacity-dim`; it never removes them.

## Layout

- The app Office uses a 320px rail beside the stage when its content area is at least 1100px wide; below that, the rail drops under it. Below 640px content width, show room cards instead of the scene. The reference HTML retains its original 340px rail.
- The rail holds HudPanels in this order: Luồng công việc, Cần bạn, Bot đang chọn, Vừa xảy ra.
- The header holds the `title`, a `data` status line (`SYS://online`, totals, the sample tag) and the FilterChip group, wrapping on narrow screens.
- The legend of states sits inside the stage, bottom-left, as StateChips.

## Iconography

- There is no icon set in this system. A bot is its initial in `display` on its core; states are dots; directions are beams.
- Inside the app (React), use the `lucide-react` icons the app already ships, at 1.5px stroke in `muted`, only where a word alone is unclear.
- No emoji, no illustrations, no mascots.

## Where the data comes from

- Bot state, job, newest step and how long: `GET /api/groups/:id/now` (`MemberNow`) for each room, plus pending approvals for `waiting`.
- Goals: the goal run (turn, max turns, status) and its plan tasks; Tester verdict, fix round and `verify` results.
- Beams: open hand-offs in the runtime tree (sender, receiver, a five-word summary of the brief, with secrets redacted).
- Events: the activity rows a goal run writes (Tester verdicts, writes audit, verify, usage hand-over, plans).
- Today the server does not yet send hand-offs or plan tasks to the client; screens built on this system show them only once it does.

## Components

StateChip, Tag, FilterChip, HudPanel, GoalFlowCard, NeedItem, BotDetail, ActivityFeed for the HTML side; BotNode, RoomPlatform and HandoffBeam for the scene. Every class is prefixed `no-`, so it never collides with the type-style classes (`title`, `room`, `label`, `body`, `data`…) that `tokens.css` defines.

## Do not

- Do not use a neon hue for decoration: if it does not mark a room kind, a state, the brand or a wait, it is `muted` or `line`.
- Do not round panels, add gradients to surfaces, or stack glows.
- Do not put more than a name, a role and one state word on a bot.
- Do not show a number without its limit, or a model without its id.
