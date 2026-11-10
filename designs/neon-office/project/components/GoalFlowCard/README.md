One running goal: its room, its turn, its task progress and its gates, clickable to light up that room.

- Markup: `<button class="no-goal k-<kind>">` with `__head` (room name + `lượt n/13 · task d/t`), `__title`, a `no-bar`, and `__foot` of Tags.
- The room kind class (`k-code`, `k-research`, `k-chat`) sets `--room`, which colors the name, the border tint and the segmented bar.
- The bar width is done ÷ total tasks. Turn and tasks are always both shown, in `data` style.
- Pressed (`.on`) means the scene is filtered to this room; clicking again clears it.
- Source: the goal run (turn, max turns, status) and its plan (tasks with status), plus the Tester gate and `verify` results.
