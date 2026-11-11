# Isolated goal branches

The room's **Branch riêng cho Worker** setting is off by default. It requires
parallel goal work, a clean Git repository root with a commit, and standing
Lead, Worker, Tester and Reviewer roles. Research rooms cannot enable it.
A missing or non-Git folder falls back to shared-folder execution with an
activity notice. A dirty Git repository is refused before any bot turn.

## Configuration and decisions

Room settings expose the switch and a newline-separated list of ignored local
files to copy, such as `.env.local`. The corresponding room fields are
`isolatedBranches: true` and `branchFiles: [".env.local"]`, set through
`PATCH /api/groups/:id`. Changes to these fields require an idle room.
Copied paths must be relative, ignored by Git and inside the original repo;
Git metadata and symlinks are refused. Nothing is copied by default. Project
profile setup commands run in integration before the first turn and in every
new Worker worktree before dispatch. Setup commands must be repeatable and
leave source files clean. The original project's ignored files stay intact.

The server creates `omb/<group-key>/<run-key>/integration` from the original
HEAD, and `omb/<group-key>/<run-key>/tasks/<sequence>-<task-key>` per Worker
assignment. Each assignment gets a fresh lane and pinned folder. Independent
tasks may run concurrently even when their declared files overlap. Actual
dependencies and locks still apply. The server commits settled tasks, audits
their actual diffs against declared writes and merges in plan order using
merge commits. Empty diffs create no task commit. Changes outside writes
produce an activity warning and remain on the task card.

Tester, Reviewer and final verify commands use integration. Reviewer receives
server-produced patch paths for merged tasks. Failure ownership uses actual
merged task diffs, with declared writes as a fallback. Source edits by a
checker invalidate its result and retain the folder for inspection. A dirty
or externally advanced integration HEAD prevents completion and merge.

On conflict the server aborts the merge, keeps the task patch and gives that
task's Worker a fresh repair worktree from integration. It allows two repair
attempts, counted in the goal's turn budget; an incomplete repair is retained
but excluded from later merges. Exhaustion ends as `needs-input`. Tester and
Reviewer must check the resulting integrated version.

Goal cards and the goal panel show the retained branch, per-task file changes,
merge phases and out-of-writes warnings. The owner or an admin can choose:

- **Merge vào branch gốc** after a completed goal: an inline confirmation
  submits the exact reviewed integration HEAD. The original folder must still
  be clean, on the same branch and original HEAD. Otherwise keep the branch
  and merge manually. The server never merges into the original automatically.
- **Giữ branch**: preserve refs and release only clean owned worktrees.
  Uncommitted and ignored files are kept.
- **Bỏ branch**: an explicit confirmation removes the owned worktrees,
  including unfinished/ignored files there, and the run's refs. It leaves
  the original folder and unrelated branches intact.

The decision endpoint is
`POST /api/groups/:groupId/tasks/:threadId/goals/:cardId/branches` with
`{ "action": "merge", "head": "<full commit id>", "confirm": true }`.
Actions are `merge`, `keep` or `discard`; only merge/discard require `confirm`.
It checks owner/admin authority, conversation visibility, active lanes, exact
card and Git HEAD, and completion before merge. Idle engine processes owned
by these lanes are released before worktree cleanup on Windows. An active or
shared engine process is never killed for cleanup; the action may refuse
until it can release the folder safely. Successful decisions are idempotent.

## Stop and restore

Worktrees, patches and the atomic `branches.json` ledger live under
`<data>/worktrees/<group-key>/<run-key>/`, outside the original repo. IDs are
hashed for paths and refs; the ledger keeps their original values. Restore
validates the namespace, canonical folders and repository ownership before
opening or deleting worktrees. Git mutations are serialized, ignore inherited
`GIT_*` routing variables and disable repository hooks.

Stop, failure or turn exhaustion retains the branch. Sending the same goal
text again in the same conversation continues a pending integration branch,
including after a server restart. Pending committed tasks are integrated
before the next dispatch; the existing integrated changes must be tested and
reviewed again. Uncommitted Worker files stay in their separate worktrees;
they are not replayed automatically. Explicitly kept/completed branches do
not resume automatically. A kept branch can still be merged from its card
after restart. An interrupted Git operation or mismatched ledger fails
closed and can require manual inspection.

## Reproduce

```sh
pnpm exec vitest run server/goal-branches.test.ts server/goal-branches.e2e.test.ts server/routes/goal-branches.test.ts src/components/GoalBranchControls.dom.test.ts
node --experimental-strip-types scripts/testing/verify-goal-branches.ts
```

Component tests use disposable real Git repos and sibling storage. The API
fixture explicitly opts into the installed Git executable while keeping a
temporary home, fake engine, data directory and isolated ports. No user's
app, project or provider account is used. It checks:

- Concurrent Workers, separate cwd and unchanged original HEAD/index/files.
- Clean ordered merges, per-task audit including rename/delete, dirty repo
  refusal, ignored-file copying, symlink/ledger tampering and disabled hooks.
- Conflict repair, two failed repairs, owner-directed Tester failures, Stop
  and continuation without repeating integrated Worker work.
- Keep, restart/restore, explicit merge, refusal after the person's edits,
  and confirmed discard that preserves those edits.
- Decision authorization, busy/hidden conversations, stale heads and UI
  confirmation cancellation, permission changes and retry errors.

The browser recipe uses isolated Chrome with the real React app through a
temporary Vite preview. It saves the room switch, waits through `control:omb`,
renders the goal card at desktop and phone widths, cancels then confirms a
merge, checks Git/files and captures console errors. Browser interactions
use DOM-dispatched events. Evidence and screenshots are written to
`.omb-scratch/verify-evidence/goal-branches/`; the API test prints its persistent
fixture log and evidence path. Both tear down their owned servers/data.

## Limits

This is Git workflow isolation, not an OS filesystem sandbox. Bots can still
attempt absolute-path access subject to their existing permissions. Ignored
checker output is not included in the source-write audit. Repositories below
the root, submodules and tracked Git LFS attributes are refused. Copying or
setup can be expensive; dependency directories are not automatically shared.
The automated recipes use fake engines: they do not qualify real-model
reasoning, provider-specific worktree behaviour, or token/time improvements.
The separate [live Inventory comparison](evidence/inventory-branches-live.json)
uses the same seed, goal and five models as the previous Inventory run. It
completed with all seven tests passing and the original folder unchanged.
It did not encounter a real-model conflict. Tokens increased in that single
trial, and the Reviewer duplicated the Tester's test command despite the
role instruction. See NOTE.md section 12.10 for the measured limits.
