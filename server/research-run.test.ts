import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadResearchGoal, researchLedgerPath } from "./research-goal.ts";
import { prepareResearchRun, type ResearchRoomInput } from "./research-run.ts";

const goalFile = {
  name: "Phase 16 sweep",
  metric: { file: "results/metrics.json", pointer: "/accuracy", threshold: 0.72, direction: "at-least" },
  seeds: { count: 1, aggregation: "mean" },
  budget: { wallMinutes: 90 },
  heldOutPaths: ["data/heldout.jsonl"],
  verify: [{ id: "suite", command: "node score.js" }],
};

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function room(overrides: Partial<ResearchRoomInput> = {}): ResearchRoomInput {
  const folder = mkdtempSync(join(tmpdir(), "omb-research-room-"));
  const dataDir = mkdtempSync(join(tmpdir(), "omb-research-data-"));
  dirs.push(folder, dataDir);
  writeFileSync(join(folder, "goal.json"), JSON.stringify(goalFile));
  const loaded = loadResearchGoal(join(folder, "goal.json"));
  return {
    groupId: "room-1",
    goalFile: "goal.json",
    goalFileHash: loaded.ok ? loaded.hash : undefined,
    folder,
    runId: "run-1",
    dataDir,
    eventsDir: join(dataDir, "events"),
    members: [{ id: "lead", name: "Lead" }, { id: "worker", name: "Worker" }],
    memberThreads: () => ["goal-thread"],
    instanceOf: () => "inst-a",
    ...overrides,
  };
}

describe("prepareResearchRun", () => {
  it("refuses a room with a Chief of Staff, before reading the goal file", () => {
    const setup = prepareResearchRun(room({ members: [{ id: "chief", name: "Quill", chiefOfStaff: true }] }));
    expect(setup).toEqual({ ok: false, status: "needs-input", detail: expect.stringContaining("Quill is a Chief of Staff") });
  });

  it("asks for approval, then blocks a file that changed after it", () => {
    const input = room();
    expect(prepareResearchRun({ ...input, goalFileHash: undefined })).toMatchObject({ ok: false, status: "needs-input" });
    writeFileSync(join(input.folder!, "goal.json"), JSON.stringify({ ...goalFile, metric: { ...goalFile.metric, threshold: 0.5 } }));
    expect(prepareResearchRun(input)).toMatchObject({ ok: false, status: "blocked", detail: expect.stringContaining("preregistration lock") });
  });

  it("keeps the ledger in the app's data folder and carries spent time and readings into the next run", async () => {
    const input = room();
    const first = prepareResearchRun(input);
    if (!first.ok) throw new Error(first.detail);
    first.wiring.recordMetric(0.6);
    first.wiring.recordEnd("blocked", "stopped");
    const ledger = researchLedgerPath(input.dataDir, input.groupId);
    expect(existsSync(ledger)).toBe(true);
    expect(existsSync(join(input.folder!, "ledger.jsonl"))).toBe(false);
    expect(readFileSync(ledger, "utf8")).toContain('"kind":"run-start"');
    const second = prepareResearchRun({ ...input, runId: "run-2" });
    if (!second.ok) throw new Error(second.detail);
    expect(second.wiring.research.priorMetricValues).toEqual([0.6]);
    expect(second.wiring.research.budgetSpentMs).toBeGreaterThanOrEqual(0);
    expect(second.wiring.research.metric).toEqual({ threshold: 0.72, direction: "at-least" });
  });

  it("reads the metric from the room folder and reports held-out paths only from tool calls", async () => {
    const input = room();
    const setup = prepareResearchRun(input);
    if (!setup.ok) throw new Error(setup.detail);
    expect((await setup.wiring.readMetric()).ok).toBe(false);
    mkdirSync(join(input.folder!, "results"));
    writeFileSync(join(input.folder!, "results", "metrics.json"), JSON.stringify({ accuracy: 0.8 }));
    expect(await setup.wiring.readMetric()).toEqual({ ok: true, value: 0.8 });
    mkdirSync(input.eventsDir);
    writeFileSync(join(input.eventsDir, "goal-thread.ndjson"), `${JSON.stringify({
      type: "item.started", itemType: "tool", createdAt: new Date().toISOString(), providerInstanceId: "inst-a", summary: "head data/heldout.jsonl",
    })}\n`);
    expect(await setup.wiring.heldOutTouched("worker", Date.now() - 60_000)).toEqual(["data/heldout.jsonl"]);
    expect(await setup.wiring.heldOutTouched("worker", Date.now() + 60_000)).toEqual([]);
  });
});
