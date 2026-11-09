import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendLeadLedger, planLeadRoundOnDisk, readLeadLedger, readLeadWorkspace } from "./lead-runner.ts";
import type { LeadGoal } from "./lead-goal.ts";

const dirs: string[] = [];

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-lead-runner-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

const goalJson = (over: Partial<LeadGoal> = {}) =>
  JSON.stringify({
    version: 1,
    id: "g1",
    goal: "go",
    metrics: ["m"],
    budget: { hours: 2, maxRounds: 5 },
    stop: { success: "ok" },
    autonomy: 1,
    createdAt: 1_000_000,
    ...over,
  });

function ballot(id: string, over: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    id,
    goalId: "g1",
    title: id,
    reads: [],
    writes: [`out/${id}.txt`],
    locks: [],
    doneWhen: "done",
    role: "implementer",
    model: { instance: "claude", model: "m" },
    dependsOn: [],
    ...over,
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readLeadWorkspace", () => {
  it("reads a valid goal and its task ballots", async () => {
    const dir = workspace({ "goal.json": goalJson(), "tasks/a.json": ballot("a"), "tasks/b.json": ballot("b") });
    const loaded = await readLeadWorkspace(dir);
    expect(loaded).toEqual({
      ok: true,
      workspace: {
        goal: expect.objectContaining({ id: "g1" }),
        ballots: [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })],
      },
    });
  });

  it("rejects a workspace with no goal file", async () => {
    const dir = workspace({ "tasks/a.json": ballot("a") });
    expect(await readLeadWorkspace(dir)).toEqual({ ok: false, error: expect.stringContaining("goal.json") });
  });

  it("rejects a goal that fails the schema", async () => {
    const dir = workspace({ "goal.json": JSON.stringify({ version: 1, id: "g1" }), "tasks/a.json": ballot("a") });
    const loaded = await readLeadWorkspace(dir);
    expect(loaded.ok).toBe(false);
  });

  it("names the task file it refused", async () => {
    const dir = workspace({ "goal.json": goalJson(), "tasks/bad.json": JSON.stringify({ version: 1, id: "bad" }) });
    const loaded = await readLeadWorkspace(dir);
    expect(loaded).toEqual({ ok: false, error: expect.stringContaining("bad.json") });
  });
});

describe("ledger", () => {
  it("reads a missing ledger as empty", async () => {
    const dir = workspace({ "goal.json": goalJson() });
    expect(await readLeadLedger(dir)).toEqual([]);
  });

  it("round-trips an appended entry", async () => {
    const dir = workspace({ "goal.json": goalJson() });
    await appendLeadLedger(dir, { at: 10, round: 1, hypothesis: "h", config: "c", result: "r", decision: "continue", improved: true });
    expect(await readLeadLedger(dir)).toEqual([
      { at: 10, round: 1, hypothesis: "h", config: "c", result: "r", decision: "continue", improved: true },
    ]);
  });
});

describe("planLeadRoundOnDisk", () => {
  it("is inert when the flag is off", async () => {
    const plan = await planLeadRoundOnDisk("does-not-exist", { dispatched: [], verified: [] }, { now: 0, maxWorkers: 5, env: {} });
    expect(plan).toEqual({ action: "disabled" });
  });

  it("dispatches two independent tasks and holds the dependent one", async () => {
    const dir = workspace({
      "goal.json": goalJson(),
      "tasks/a.json": ballot("a"),
      "tasks/b.json": ballot("b"),
      "tasks/c.json": ballot("c", { dependsOn: ["a", "b"] }),
    });
    const plan = await planLeadRoundOnDisk(dir, { dispatched: [], verified: [] }, { now: 1_000_001, maxWorkers: 5, env: { OMB_LEAD_DEPT_CAP: "1" } });
    expect(plan).toEqual(expect.objectContaining({ action: "approve-and-dispatch", wave: [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })], serialize: [] }));
  });

  it("stops on a vendor rule violation", async () => {
    const dir = workspace({
      "goal.json": goalJson(),
      "tasks/i.json": ballot("i", { role: "implementer", model: { instance: "claude", model: "m" } }),
      "tasks/e.json": ballot("e", { role: "evaluator", model: { instance: "claude", model: "m" }, writes: ["e.txt"] }),
    });
    const plan = await planLeadRoundOnDisk(dir, { dispatched: [], verified: [] }, { now: 1_000_001, maxWorkers: 5, env: { OMB_LEAD_DEPT_CAP: "1" } });
    expect(plan).toEqual({ action: "stop", reason: expect.stringContaining("share vendor") });
  });
});
