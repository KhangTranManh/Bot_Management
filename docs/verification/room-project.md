# Project profiles and the pre-goal baseline

Run the isolated server workflow and focused checks:

```sh
pnpm exec vitest run server/room-project.e2e.test.ts server/room-project.test.ts server/group-goal-run.test.ts server/host/goal-cards.test.ts server/verify-run.test.ts
```

The end-to-end check uses `launchVerificationServer` with a temporary home,
data directory and fake engine. It saves a project profile through the real
room API and checks both the wire response and `groups.json`. Invalid profiles
are refused before changing the saved configuration.

Its setup and verify commands execute real Node scripts in the disposable
project folder. The first verify call deliberately fails; the synthetic script
passes on the second call. The check proves setup → baseline → Lead → final
verify ordering, baseline propagation into the engine's instructions, and the
baseline's retention on the completed goal card. This synthetic repair does
not prove a model can repair a project.

A second room keeps failing. Its original failure remains on the card, and
completion is refused through the three-fix-round limit. A third room's setup
fails before any provider turn; its card records the setup failure and zero
turns. A room without a folder blocks before pinning its thread; setting the
folder and resending the goal recovers on that same thread. The fixture clears the first room's profile without losing the existing
goal's baseline. `control-omb wait` and `messages` results, API actions and
resulting state are retained beside the fixture log as `*.room-project.json`.
The owned fixture closes and removes its data directory; its log and evidence
remain.

The loop tests cover propagation to Workers, Tester and Reviewer on the runtime
wave path and to direct steps, expected nonzero exit codes, cancellation during
preparation, setup failure, and a missing working folder. The command-runner
test checks that Stop kills the shell's command tree before a delayed write,
and that a previously aborted command never starts.

## Configuration

Set `projectProfile` through `PATCH /api/groups/ID` on an explicitly launched
fixture. Supply a working folder in that fixture, and use the room's existing
`verify` list for build, test and lint commands:

```json
{
  "projectProfile": {
    "instructions": "Follow AGENTS.md and CLAUDE.md. Keep changes readable and test changed behaviour.",
    "moduleMap": "src/api: HTTP routes; src/domain: inventory rules; tests: integration checks.",
    "protectedPaths": ["vendor/", "db/migrations/"],
    "setup": [{ "id": "dependencies", "command": "npm ci", "timeoutSec": 120 }]
  },
  "verify": [
    { "id": "build", "command": "npm run build" },
    { "id": "tests", "command": "npm test" },
    { "id": "lint", "command": "npm run lint" }
  ]
}
```

Instructions and module map are each limited to 4000 characters. Protected
paths allow up to 16 relative file or folder names, each at most 200 characters.
Setup uses the same validation, working-folder rules and timeout bounds as
`verify`, with up to eight commands. Setup runs before **each goal** with this
profile, so choose repeatable commands; omit it when dependencies are already
ready. Setup failures block before the first bot turn. A profile without a
working folder also blocks. Ordinary room chat does not run these commands.

`projectProfile: {}` enables the baseline without extra project context.
`projectProfile: null` removes the profile and restores completion-only verify
behaviour. A profile without verify commands explicitly reports its baseline
as unverified.

The goal card's `baseline` holds timestamps, setup results and verify results,
including the command id, actual exit code (`null` for a killed or unavailable
command), expected exit code, and at most 1000 characters of redacted output.
The Lead receives the original baseline on every turn; Worker, Tester and
Reviewer assignments receive it too. A baseline failure is a pre-existing
command failure, not proof that a particular test or Worker is at fault. It
does not waive the final completion checks.

Protected paths and conventions are instructions to the bots, not filesystem
enforcement. The server does not read the referenced instruction files into
the profile or automatically discover build/test commands. The profile and
baseline have no dedicated renderer controls yet. Checks remain one shared
verify list; separate focused-per-round and full-final lists are not implemented.
