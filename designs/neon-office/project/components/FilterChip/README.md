A toggle that narrows the scene to some rooms; exactly one in a group is pressed.

- Markup: `<button class="no-chip-btn" aria-pressed="true|false">`, inside a `role="group"` with an `aria-label`.
- Pressed state: `fg` text, `cyan` border, `glow-cyan`. Rest: `muted` text, `line-strong` border, `radius-sm`.
- A count goes in `<span class="n">` and is set in `wait`: it counts things waiting for the person.
- Filtering dims what does not match to `opacity-dim`; it never hides a room.
