A bot in the scene: a glowing core with its initial, a name tag with its role, and a state word above.

- Markup: `<g class="no-bot is-<state>" tabindex="0" role="button" aria-label="Name, role, state">` holding `circle.halo`, `circle.core`, `circle.ring`, `text.ini`, `rect.no-pill`, a `text` with `tspan.no-pill-name` and `tspan.no-pill-role`, and `text.no-state-tag` unless idle.
- Sizes: core r10, halo r16 blurred by `#no-soft`, ring r15; tag 18px tall with `radius-xs` corners, 38px above the core; state word 47px above.
- Only a running bot's halo pulses (`no-pulse`). Selected or focused: dashed `magenta` ring and `magenta` tag border.
- The anchor point for beams is the core's center: the desk's world point plus (0, 0.75, 1.05).
- A bot without a role shows its name only. Never show more than the name, role and one state word.
