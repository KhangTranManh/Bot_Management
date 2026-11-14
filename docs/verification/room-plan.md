# Room outline (`/plan`)

Verifies that `/plan` turns the Lead's reply into a checked outline card, that the
card saves into the project profile, and that a later goal starts from it.

## Automated

- `server/room-plan.test.ts`: the outline validator (unknown fields such as `tasks`,
  repeated waves, areas outside the structure), the reply envelope, which saved
  outline a goal picks, and the Lead's instructions.
- `server/group-goal-run.test.ts` ("a saved outline"): the loop sends the outline to
  the Lead, adopts it when the first plan has no brief, and refuses a changed brief
  once unless it carries `planChangeReason`.
- `server/room-plan.e2e.test.ts`: the fake engine answers a `/plan` with a reply that
  holds `tasks` (refused), then a valid one; the card is `ready`, the envelope never
  reaches the chat, the profile accepts the outline and refuses one with `tasks`, and
  the next goal's prompt contains the saved waves.
- `src/components/office/goal-plan-source.test.ts`: the goal panel's outline section.

## Browser

```sh
node --experimental-strip-types scripts/testing/verify-room-plan.ts
```

Launches an isolated fixture with a scripted Lead, sends `/plan`, and checks the
card (structure with a read-only area, waves, open question, no envelope text), no
horizontal overflow at 1366 and 390 pixels, the save button writing
`projectProfile.plan`, and a clean console. Evidence lands in
`.omb-scratch/verify-evidence/room-plan/`.

## Not covered

A real model following the Lead playbook, and a goal run in a room with a team (the
outline reaching a Worker task through `planSource`) are not exercised by a browser
or live run yet.

## Code shape check

`scripts/testing/check-code-shape.ts <project> --max-line 120 --max-file 300 --forbid web=server`
fails on long lines, long files and imports across a forbidden folder boundary.
