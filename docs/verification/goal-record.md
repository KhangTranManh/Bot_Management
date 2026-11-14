# Goal brief, baseline, conflicts and the project profile editor

Run the focused checks, then the isolated browser check:

```sh
pnpm exec vitest run src/components/GoalRunPanel.dom.test.ts src/components/office/goal-run-flags.test.ts src/components/room-panel/RoomProjectSettings.test.ts src/components/room-panel/VerifyCommandsEditor.test.ts src/state/store.test.ts
node --experimental-strip-types scripts/testing/verify-goal-record.ts
```

The browser check launches its own fixture with the scripted fake engine and a
disposable project folder, then drives the Neon skin through the Vite preview:

- saves a project profile (a Web full-stack template, instructions, a protected path and one setup
  command) from the room panel and checks the saved profile through the API;
- checks that the template selector fits at 1366px and 390px, and that the
  completed goal's fake-engine instructions contain the template and Lead playbook;
- sends a goal whose scripted Lead writes a brief; setup and verify run for
  real in the project folder, and the verify command fails before the Worker
  writes its file;
- gives the brief a structure of two areas, one read-only, and checks both areas on the panel;
- checks the card's flag line (`gốc 1 lệnh lỗi`), then opens the goal panel and
  checks the brief lists, both baseline rows with their pass state, and that no
  conflict section shows for a run without conflicts;
- measures the page and the panel at 1366×768 and 390×844 for horizontal
  overflow and takes screenshots;
- reopens the profile, clears only the template and confirms that the other
  fields survive, then removes the profile and checks that the API returns
  `projectProfile: null`, that the editor empties, and that the finished goal
  keeps its baseline;
- fails on any console error.

Screenshots and `goal.json`/`result.json` land in
`.omb-scratch/verify-evidence/goal-record/`.

The scripted engine writes files directly instead of reporting edit tool calls,
so the server never attributes its edits and cannot record a conflict. The
conflict section is covered by `src/components/GoalRunPanel.dom.test.ts` with a
card that carries one; the server side of conflicts is covered by
`server/group-goal-run.test.ts` and `server/host/goal-cards.test.ts`.

Open questions in a brief stop the run at `needs-input` before any work; the
panel lists them first and the card counts them. Baseline rows show the exit
code against the expected one; a command that could not start shows as not
run. A failing baseline check does not waive the final verify gate.
