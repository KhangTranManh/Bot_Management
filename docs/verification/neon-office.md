# Neon Office frontend

This recipe uses `control-omb`'s isolated fake-engine server and the real React app through a disposable Vite
preview. Chrome has its own temporary profile. No live app, existing account, model quota or user database is used.
The recipe checks both the UI actions and the resulting state returned by the existing backend.

## Run

Install dependencies, then set `AGENT_BROWSER_EXECUTABLE_PATH` to a local Chromium/Chrome executable if it is not
`C:/Program Files/Google/Chrome/Application/chrome.exe`:

```powershell
$env:AGENT_BROWSER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --experimental-strip-types scripts/testing/verify-neon-office.ts
```

The browser helper uses Chrome's loopback debugging endpoint in the isolated profile. It does not use or attach to
an existing Chrome session. This avoids the agent-browser daemon's socket-directory failure on this Windows host.
The fake server and preview use the shared verification launch helpers. The `finally` block closes the browser,
preview and exact fixture server, and the fixture removes its own data directory.

## Checks and evidence

- Two rooms, real API snapshots and `/now` polling; Office opens through its sidebar button.
- Neon default and 240px sidebar, without a new backend route.
- 1920×1080, 1440×900, 1366×768, 1280×720 and 390×844; no document-wide horizontal overflow.
- A 683×384 CSS viewport at device scale 2 exercises the layout equivalent of a 1366×768 display at 200% zoom.
  This emulates the resulting viewport; it does not drive the browser's zoom menu.
- Room list on phones; code/research filters; keyboard selection of a bot; opening a room.
- Saving `npm test` from the verify editor and confirming the saved value from the API. Saving does not run it.
- A missing goal file produces the server's error; a valid goal file is approved and its returned SHA-256 checked.
- Switching to the saved Daylight skin and 300px sidebar width preserves both choices across a reload.
- Read-only snapshots of the `messages.db` and `runtime.db` schema SQL are identical before and after UI actions.
- Browser console has no error entries.

The command prints the fixture URL and persistent server log path. Screenshots and result JSON are kept in
`.omb-scratch/verify-evidence/neon-office/` (gitignored): `office-*.png`, `room-settings.png`,
`research-settings.png` and `result.json`. These contain synthetic fixture data.

## Related checks

```sh
pnpm exec vitest run src/components/office/office-model.test.ts src/components/room-panel/RoomWorkflowSettings.test.ts src/lib/skins.test.ts src/lib/skins.default.test.ts electron/skin-overlay.test.mjs
pnpm check:contrast
pnpm i18n:check
pnpm build
```

The unit checks cover pending-card filtering, quota-state evidence, run boundaries, verify validation and skin
preference retention. The contrast check measures Neon with the existing skin rules. Fonts ship in the build;
their copyright notices and SIL OFL 1.1 are included at `public/fonts/neon-OFL.txt`.

## Scope

Only the frontend and native skin color map change. No server/shared wire definitions, DB columns, migration,
goal scheduling or verification/approval rules change. The workflow editor sends the existing group PATCH fields.
Office counts cards in already-loaded history and uses existing queue metadata. Role links show the configured
workflow; a task beam appears only from the Lead to a member whose `/now` job is running while the room's latest goal
is working.
The goal panel labels thread usage as thread usage, not per-run/per-role totals.

Detailed plans, handoff traces, research ledger graphs and per-run/per-role accounting remain outside this
frontend-only change because the current snapshot does not supply the required data.
