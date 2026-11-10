A room as an isometric platform: tinted floor, glowing edge, its name lettered on the floor, a desk per member and a HUD tag above its back corner.

- Markup: `<g class="no-room k-<kind>">` holding two `no-plat-side` faces (the left-front one at 0.75 opacity), `no-plat-glow`, `no-plat-top`, `text.no-floor-text` laid on the floor with `matrix(0.866 .5 -0.866 .5 x y)`, desks, BotNodes, and the HUD tag.
- The kind class sets `--room`: `cyan` for code, `acid` for research, `violet` for chat. Nothing else in the room picks its own hue.
- Geometry: thickness `iso-platform`; a desk is `iso-desk` (1.7 × 1.1 × 0.5) with a screen on its back edge; seats on a 2-column grid (3 when more than four members), drawn back to front by x + y.
- HUD tag: a notched path, `no-hud-name` (room name), `no-hud-kind` (code / research / chat) and `no-hud-meta` ("lượt n/13" or "không có goal"), 62px above the back corner.
- Dimmed rooms take `.dim` (`opacity-dim`).
