A bot's state as a neon dot and an uppercase mono word.

- Markup: `<span class="no-state is-<state>">…</span>`; `<state>` is one of `running`, `queued`, `waiting`, `out`, `idle`.
- Colors come only from `run`, `queue`, `wait`, `out`, `idle` through the `is-*` class; never set a state color by hand.
- Words, lowercase in data and uppercased by the class: *đang xử lý*, *xếp hàng*, *chờ bạn*, *hết lượt*, *rảnh*.
- Source: `MemberNow.state` gives `running` / `queued`; a pending approval or `needs-input` gives `waiting`; the usage-limit hand-over gives `out`; no job gives `idle`.
