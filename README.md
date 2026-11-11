<div align="center">

# Bot Management

**A team of AI bots in one chat app, run as a real team: a Lead that plans, Workers that build in parallel, a Tester that signs off.**

Built on [OpenMausBot](https://github.com/milind-soni/OpenMausBot) · local-first · bring your own agents

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Node](https://img.shields.io/badge/Node-24%2B-339933?logo=node.js&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-macOS%20%C2%B7%20Windows%20%C2%B7%20Ubuntu-2B2E3A?logo=electron&logoColor=9FEAF9)
![License](https://img.shields.io/badge/license-Apache%202.0-blue)

</div>

---

## What this is

Every bot in the sidebar is a real agent (Claude, Codex, Grok, OpenCode, ZCode, or any ACP-speaking CLI) running on
your own machine, with its own model, folder, computer and connected apps. Put several bots in a **room** and they
work as a team on one goal.

This repository is a fork of OpenMausBot that focuses on **how that team works together**: who plans, who builds,
who checks, what happens when you interrupt, and how you see what everyone is doing.

<p align="center">
  <img src="docs/images/neon-office.gif" alt="The team office: rooms as isometric platforms around the Chief of Staff, each bot at a desk with its state, hand-offs travelling between bots, and a side rail of running goals, things waiting for you, the selected bot and recent events." width="880">
</p>
<p align="center"><sub>The <a href="designs/neon-office/README.md">Neon Office</a> design reference — a preview with sample data. The app's Office uses available room data from the existing API.</sub></p>

The approved UI definitions cover the Office, sidebar, room settings, goal plan/checks/usage panel, research approval
and skin picker. Neon will be the default dark skin; existing skins stay available, and the Office gets its own sidebar
entry. The frontend implementation keeps backend code and database schemas unchanged. See the
[design index](designs/neon-office/README.md) and [`NOTE.md`](NOTE.md) §10.5–10.8 for scope and remaining data requirements.

## What's new in this fork

### Team workflow

| | |
|---|---|
| **Standing roles per room** | Give each member a role — **Lead**, **Worker**, **Tester** or **Reviewer** — from the room's *Team status*. The Lead coordinates every goal; it never takes a task itself. Roles live on the room, so one bot can be a Worker here and a Tester elsewhere. |
| **Parallel waves by default** | In a room of three or more, the Lead plans tasks with dependencies and declared writes; independent tasks run side by side, each in its own lane thread. With standing roles, Worker assignments require a task plan; the Lead is instructed to split independent modules among available Workers. Tasks that touch the same files run one after another. A *Parallel goal work* switch turns it off per room. |
| **Tester gate** | A plan with Worker tasks gets a Tester task that waits on them. The goal cannot complete until the Tester ends with `VERDICT: PASS`. A failure starts a fix round for the Worker who owns the file (at most three). A room can also list its own check commands (`verify`, set through the API for now): the server runs them itself and the goal completes only when they exit as expected. A Tester that edits files outside its report has its PASS voided. |
| **Review after implementation** | When the room has a Reviewer, a Worker plan also gets a review task waiting on the changed work. Review and testing can run together. The Lead must obtain a review of the latest Worker changes before completing and assess its findings; a review report is not a test verdict. |
| **Focused goal context** | Goal turns omit unrelated recent-work briefs and select installed playbooks from the current goal assignment rather than old room messages. Handoffs ask for file references, check outcomes and actionable failures instead of full files and successful logs. Room history, standing instructions, permissions and required skills remain available. |
| **Plan checks** | A plan that hands work to the Lead, to a member without a role, or to a Worker without listing what it writes goes back to the Lead to fix. Sending the Tester or Reviewer before any Worker has worked is refused once (send it again for a deliberate baseline). |
| **Reviewers read only** | Review tasks run as consultations at the *Ask* level: any write or command waits for your approval. Hard-enforced with `OMB_ROLE_CEILING=1` (a consultation node's recorded level caps the turn and the app's auto-approvals); without the flag it relies on the model following its role. |
| **Out of AI usage** | A member whose model hits its usage limit or runs out of credits leaves the run; the Lead is told to hand its task to a free member of the same role. Bots with a backup AI configured keep going on it, as before. |

### Research rooms

A room set to `kind: "research"` runs goals only against a preregistered goal file (JSON in the room's folder:
metric, seeds, budget, checks, optional pilot size, handoff files and held-out paths). Set it through the API for
now: `PATCH /api/groups/:id` with `goalFile`, then `researchGoalApprove: true`, which locks the file's hash.

| | |
|---|---|
| **Approved file or no run** | A run stops at *needs input* until the file validates and is approved; a file edited after approval blocks the run. A room with a Chief of Staff in it does not run. |
| **Done means the metric** | The server runs the file's checks, then reads the metric through its JSON pointer and aggregates the seeds. Below the threshold the Lead plans the next experiment; `maxExperimentRounds` and `stopAfterFlatRounds` end the research with a negative result. |
| **Budget across runs** | The budget counts active time over every run of the approved file, from the server's ledger in its own data folder. |
| **Pilot, handoff, held-out** | The first accepted plan is held to `pilot.maxTasks`; completion waits for `handoff.expectsFiles`; a member's tool call naming a held-out path is reported. |
| **Roles** | The role ceiling is always on in a research room. An **Evaluator** role joins Reviewer under the vendor rule: neither may run the same model maker as a Worker in the plan. `/research` sends a request as a goal there. |

### Talking to a team that is working

| | |
|---|---|
| **Ask anyone, stop no one** | Mention a teammate while the room is busy (`@Clover is the API done?`) and it answers in a lane of its own. The running work and every other bot keep going. A teammate that is busy answers after its current step. Stop still ends the whole tree of work it started, by design. |
| **Progress at once** | A short question such as *"how is it going?"* or *"tình hình sao rồi"* while the room works is answered immediately by the app — goal turn, who is on what, for how long, latest step — without spending a bot turn. |
| **Work requests become goals** | In a room with a Lead, a message that asks for work (*"build the checkout page"*, *"fix the login bug"*) starts a goal automatically. Start a message with `/chat` to just talk, or `/goal` to force a goal. Switchable per room. |

### Seeing what is happening

- **Office** in the sidebar: live room status, current goals, pending cards, selected bot and recent activity. It polls
  the existing room `/now` route while visible. Seats follow the roles (Lead, then Workers, then Tester/Reviewer) and
  dashed links draw the team workflow above: Chief → Lead, Lead → each Worker, each Worker → Tester/Reviewer. While a
  goal runs, a beam labelled with the task goes from the Lead to each member running a job; real queue waits are blue.
  On narrow screens it becomes a room list. New installs use the Neon
  skin and a 240px sidebar; saved skins and sidebar widths are preserved. Choose **Neon Office** in Appearance to switch.
- **Room workflow settings**: edit room kind and verify commands, select a research goal file and approve its hash
  using the existing group PATCH route. The server retains validation and approval authority.
- **Team status** in the room panel: each member's role, model, and live state — working, coordinating
  (turn n/13), waiting for you, idle or unavailable — plus the job it is running, how long it has run and its
  newest step.
- **Goal panel**: click a goal card to see the run's turn, the team, and every result since the goal started.
- Long bot replies in a room fold to their opening with **Show full**.

### Tried with real models

Live-engine trials ran end to end with Claude Opus/Sonnet/Haiku 5.5 and Codex 5.6/6.x models in isolated
data folders, driven through the same API the app uses:

| Goal | Result | Turns |
|---|---|---|
| Fix a two-bug Node library | completed, tests pass, only `src/` changed | 7 / 13 |
| Fix a four-module service plus a new rule (one Worker, then two in parallel) | completed both times | 5, then 4 / 13 |
| Repeat that service with Lead Sol 6.0, Workers Terra 6.1/Luna 6.0, Reviewer Sol 5.6 and Tester Haiku 5.5 | completed, 7/7; Reviewer found a rounding edge case and the team fixed and rechecked it | 7 / 13 |
| Toy classifier to 0.90 accuracy (research room) | completed, server-read metric 0.95 over 3 seeds | 5 / 13 |
| Phase 16 transcript extraction for a real CPU scorer (research room) | completed, label agreement 1.0 on the locked set | 5 / 13 |
| This repository fixing its own goal loop | completed, the Reviewer caught a comment-rule breach and the Lead opened a fix round | 11 / 13 |

Small completed trials used about 0.35–0.90 M tokens; the self-fix on this repository about 3.5 M. The latest service
run used 903,484 tokens over 203 seconds, versus 352,321 over 65 seconds before: parallel work and review were used,
but token savings were not demonstrated. Models, participants and repair rounds differ between runs. Token totals
sum input and output across model steps; they are not the size of one prompt. Prices are missing for the 6.x rows,
so the recorded USD sum is incomplete. See the [comparison evidence](docs/verification/evidence/inventory-live-comparison.json)
and [`NOTE.md`](NOTE.md) §12 for per-role numbers.

### Known limitations

- Writes outside a task's declared `writes` are reported after each wave in a git folder, not blocked; ignored
  files are not seen.
- Without `verify` commands, PASS rests on the Tester's `VERDICT` line. With them, the files those commands run
  (tests, package scripts) can still be edited by the bots.
- Outside research rooms the role permission ceiling needs `OMB_ROLE_CEILING=1`; without it, consult-at-Ask
  relies on the model.
- API keys are stored as plain text in `config.json` (inherited from upstream).
- A local machine has no filesystem sandbox: out-of-bounds writes are detected after the fact at best.
- The research metric file and the scripts that write it live in the room folder, where bots can edit them; until
  results come with provenance (manifest + validator) a reached threshold shows the checks agreed, not that the
  numbers are honest.
- The held-out scan sees only tool calls the engine reports; reading a path through another route goes unseen.
- The 13-turn goal limit pauses a run without a hand-off summary; sending the goal again restarts the count.
- Office uses the room snapshots and history already loaded by the app; the pending-card count is limited to that
  history. Office beams run from the Lead to members working during a goal, not from per-task hand-off records;
  detailed task dependencies, research ledger charts and per-run/per-role usage are not exposed by the current API. The goal panel labels thread totals separately instead of treating them as run totals.
- There is no automatic rotation across engine accounts when usage runs out. An explicitly configured backup AI
  keeps its existing recovery behavior; otherwise the Lead needs another available member of the same role.
- A Worker that edits a file another Worker declared is reported, not stopped.

### Engines and fixes

- **ZCode** built-in engine through [`zcode-acp-server`](https://github.com/william0wang/zcode-acp): its models
  (`provider\model` ids) appear in the picker; on Windows the app finds the ZCode CLI and Node itself
  (`ZCODE_BIN` / `ZCODE_NODE` override them).
- **Grok** with a tool selection no longer refuses when `~/.grok/config.toml` contains arrays of tables such as
  `[[marketplace.sources]]`.

The design notes and the progress log are in [`docs/plans/team-workflow.md`](docs/plans/team-workflow.md) and
[`docs/plans/lead-layer-note.md`](docs/plans/lead-layer-note.md).

## Quick start

Requirements: **Node 24+**, **pnpm**, and at least one agent CLI installed and signed in (`claude`, `codex`,
`grok`, `opencode`, `zcode-acp-server`, …). Windows, macOS and Ubuntu 24.04 are supported.

```sh
git clone https://github.com/KhangTranManh/Bot_Management && cd Bot_Management
pnpm install

pnpm dev:server    # harness server → http://127.0.0.1:8799
pnpm dev           # app → http://127.0.0.1:5199
pnpm dev:desktop   # optional Electron shell; keep the two above running
```

Engines you have installed appear in the model picker automatically. Optional keys (Composio, Boat, voices)
go in **App Settings**; local chat works without them.

## Running a team

1. Create a room with your bots, open its panel (click the room name), and set roles in **Team status**:
   one Lead, one or more Workers, a Tester, optionally a Reviewer.
2. Send the work: *"build a shop page with cart and checkout"*. In a room with a Lead it runs as a goal; elsewhere,
   type `/goal` first.
3. Watch it in **Team status** or click the goal card. Ask anyone anything while it runs — nothing stops.
4. A goal ends when the Lead reports it complete after the Tester passes, when it needs you, when it is blocked,
   or at the 13-turn safety limit (a parallel batch counts as one turn). Send the goal again to continue.

| Setting | Where | Default |
|---|---|---|
| Roles | Room panel → Team status | none (goals run without role rules) |
| Run work requests as goals | Room panel | on once the room has a Lead |
| Parallel goal work | Room panel (rooms of 3+) | on |
| `OMB_LEAD_DEPT_CAP` | server environment | unset; `0` turns parallel waves off everywhere, `1` on for any room |

## How it works

```mermaid
flowchart LR
    subgraph app ["App — React + Tailwind (5199)"]
        UI[Chat · rooms · team status · goal panel]
    end
    subgraph server ["Harness server (127.0.0.1:8799)"]
        GOAL[Goal loop · roles · tester gate] --> RT[Runtime tree · lanes]
        REG[Driver registry] --> BUS[Event bus → SSE]
        BROKER[Permission broker]
    end
    subgraph agents ["Agents on your computer"]
        CL[claude] & CX[codex] & GR[grok] & OC[opencode] & ZC[zcode-acp-server]
    end
    UI -- "HTTP commands" --> server
    BUS -- "one SSE stream" --> UI
    RT --> REG
    REG --> CL & CX & GR & OC & ZC
    CL & CX & GR & OC & ZC -- "permission requests" --> BROKER
```

| Layer | Where | What it does |
|---|---|---|
| Goal loop | `server/group-goal-run.ts`, `server/team-roles.ts`, `server/lead-schedule.ts` | Lead turns, plan checks, wave scheduling, Tester gate, fix rounds, usage-limit handover |
| Runtime tree | `server/runtime/`, `server/runtime-coordinator.ts` | Hand-offs between bots, lanes, queuing when a bot is busy, budgets, restart recovery |
| Rooms | `server/routes/channels.ts`, `server/room-now.ts` | Sends, side replies, progress answers, live team status (`GET /api/groups/:id/now`) |
| Drivers | `server/drivers/` | One per engine, normalised into one runtime event stream |
| App | `src/` | Chat shell, room panel, goal panel, composer commands |
| Desktop | `electron/` | macOS, Windows and Ubuntu shells with an embedded harness |

Other capabilities inherited from OpenMausBot — approval cards, cloud and local computers, connected apps,
voice and calls, triggers and webhooks, the MCP server and the `openmausbot` CLI — work as documented in
[`docs/`](docs/).

## Development

```sh
pnpm typecheck      # app + server
pnpm lint           # oxlint, warnings fail
pnpm test           # unit, driver, API, e2e and desktop tests
pnpm build          # typecheck + production build
```

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md): verify against an isolated fixture, never your live
data. Code conventions are in [`AGENTS.md`](AGENTS.md).

Known test caveat on Windows: `shared/app-frame/helper.test.ts` is timing-sensitive and can fail intermittently;
it fails the same way on the upstream base.

## License and credits

[Apache License 2.0](LICENSE). Based on OpenMausBot © 2026 Milind Soni and OpenMausBot contributors; changes in
this fork © 2026 their authors. `enterprise/` is source-available under its [own license](enterprise/LICENSE).
See [LICENSING.md](LICENSING.md) and [NOTICE](NOTICE).

Neon bundles Be Vietnam Pro, Chakra Petch and JetBrains Mono under [SIL OFL 1.1](public/fonts/neon-OFL.txt).

Packaged Cua Driver components keep their upstream licenses; notices and the SBOM are in
[`third_party/cua-driver/`](third_party/cua-driver/).

Not affiliated with xAI, Anthropic, OpenAI, Z.ai or the makers of any engine it runs; product names are trademarks
of their owners.
