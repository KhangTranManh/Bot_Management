The selected bot in full: who, which room, state, model, job and newest step.

- Markup: `.no-detail` with `.no-detail__who.is-<state>` (dot with the initial, name, "role · room") and a `<dl>` of four rows in this order: Trạng thái, Model, Việc, Bước mới nhất.
- Model and step are `no-mono`; the state is a StateChip followed by how long, when known.
- Lives in a HudPanel with `aria-live="polite"` so a new selection is announced.
- Source: `MemberNow` (task, step, since) and the bot record (role in the room, model selection).
