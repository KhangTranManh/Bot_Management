# Example goal — a job for the "Ban IT" (lead-dept)

A complete example of one job the Lead department runs: a landing page (task `a`),
its analytics (task `b`), and a signup form wired on top of both (task `c`, which
depends on `a` and `b`). Two tasks run in parallel, the third waits.

## The files

- `goal.json` — the goal contract (objective, metrics, budget, stop conditions,
  forbidden/protected paths, autonomy level). `createdAt` is optional and defaults
  to "now" when first read.
- `tasks/*.json` — one immutable ballot per task: `reads`, `writes`, `locks`,
  `doneWhen`, `role`, `model`, `dependsOn`. A task's status is never in its file —
  it lives in the ledger.

## Run it

```sh
# 1. Install the department once (5 bots: Lead + 4 roles)
openmausbot team apply lead-dept/lead-dept.v2.json

# 2. See the plan the deterministic scheduler produces (lead-dept feature on)
OMB_LEAD_DEPT_CAP=1 openmausbot lead plan lead-dept/example-goal --json
```

`lead plan` prints two waves — `a, b` (parallel, no conflicts) then `c` (it reads
what `a` and `b` write) — plus the next round to approve. At autonomy level 1 the
Lead never dispatches before you approve this plan.

## The loop the Lead runs

1. Read `goal.json` and every `tasks/*.json` in its working folder.
2. Plan waves: tasks run in parallel only when their write sets don't overlap, no
   task writes what another reads, and no two share a lock — otherwise in order,
   and always after `dependsOn` is satisfied.
3. Dispatch the wave with `coordinate_bots` (one call per ≤4 teammates), then end
   the turn. Results resume the Lead automatically; do not poll.
4. Verify each task: the Evaluator (a different vendor than the Implementer) checks
   `doneWhen`, and the Reviewer (a third vendor) reviews. The hard rule lives in
   `server/lead-roles.ts` — implementer must differ from evaluator and reviewer.
5. Append one line to `ledger.jsonl` for the round: `at`, `round`, `hypothesis`,
   `config`, `result`, `decision` (`continue` | `redirect` | `stop`), `improved`.
   Only the Lead writes the ledger.
6. Decide the next round, or stop: budget exhausted, or two rounds in a row with no
   improvement. At level 1, every dispatch waits for your approval.

The ledger is JSON lines, one per round. Nothing in a goal, a task ballot, or the
ledger ever carries a key or secret — the harness and the permission broker own
credentials; the Lead layer never sees them.
