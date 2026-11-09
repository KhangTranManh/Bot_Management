import { describe, expect, it } from "vitest";
import { leadGuard, parseLeadGoal, parseLeadTaskBallot, type LeadGoal, type LeadLedgerEntry } from "./lead-goal.ts";

const goalText = JSON.stringify({
  version: 1,
  id: "g1",
  goal: "Tang coverage len 90%",
  metrics: ["coverage"],
  budget: { hours: 2, maxRounds: 5 },
  stop: { success: "coverage >= 90", failNoImproveRounds: 2 },
  forbidden: ["node_modules"],
  protectedSets: ["data/gpu"],
  sharedInputs: ["data/input.csv"],
  autonomy: 1,
  createdAt: 1_000_000,
});

const ballotText = JSON.stringify({
  version: 1,
  id: "t1",
  goalId: "g1",
  title: "Them test",
  reads: ["src/a.ts"],
  writes: ["src/a.test.ts"],
  locks: ["gpu"],
  doneWhen: "test pass",
  role: "implementer",
  model: { instance: "claude", model: "claude-sonnet-5" },
  dependsOn: [],
});

describe("parseLeadGoal", () => {
  it("parses a valid goal with defaults", () => {
    const r = parseLeadGoal(goalText);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.autonomy).toBe(1);
      expect(r.value.constraints).toEqual([]);
      expect(r.value.stop.failNoImproveRounds).toBe(2);
    }
  });
  it("rejects invalid JSON", () => {
    expect(parseLeadGoal("{khong hop le").ok).toBe(false);
  });
  it("rejects bad autonomy and missing budget", () => {
    const bad = JSON.parse(goalText);
    bad.autonomy = 4;
    expect(parseLeadGoal(JSON.stringify(bad)).ok).toBe(false);
    const noBudget = JSON.parse(goalText);
    delete noBudget.budget;
    expect(parseLeadGoal(JSON.stringify(noBudget)).ok).toBe(false);
  });
});

describe("parseLeadTaskBallot", () => {
  it("parses a valid ballot with defaults", () => {
    const r = parseLeadTaskBallot(ballotText);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.locks).toEqual(["gpu"]);
  });
  it("rejects unknown role", () => {
    const bad = JSON.parse(ballotText);
    bad.role = "boss";
    expect(parseLeadTaskBallot(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe("leadGuard", () => {
  const goal: LeadGoal = (parseLeadGoal(goalText) as { ok: true; value: LeadGoal }).value;
  const entry = (improved: boolean): LeadLedgerEntry => ({ at: 0, round: 1, hypothesis: "h", config: "c", result: "r", decision: "continue", improved });
  it("runs inside budget", () => {
    expect(leadGuard(goal, [], goal.createdAt + 1000)).toEqual({ action: "run" });
  });
  it("stops on hours budget", () => {
    expect(leadGuard(goal, [], goal.createdAt + 3 * 3_600_000)).toEqual({ action: "stop", reason: "budget-hours" });
  });
  it("stops on rounds budget", () => {
    const ledger = Array.from({ length: 5 }, () => entry(true));
    expect(leadGuard(goal, ledger, goal.createdAt)).toEqual({ action: "stop", reason: "budget-rounds" });
  });
  it("stops after 2 consecutive non-improving rounds", () => {
    expect(leadGuard(goal, [entry(true), entry(false), entry(false)], goal.createdAt)).toEqual({ action: "stop", reason: "no-improvement" });
  });
  it("does not stop when one of the last rounds improved", () => {
    expect(leadGuard(goal, [entry(false), entry(true)], goal.createdAt)).toEqual({ action: "run" });
  });
});
