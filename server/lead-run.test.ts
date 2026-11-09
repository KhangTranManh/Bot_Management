import { describe, expect, it } from "vitest";
import { ledgerToJsonl, makeLedgerEntry, parseLedgerJsonl, planLeadRound } from "./lead-run.ts";
import { parseLeadGoal, type LeadGoal, type LeadTaskBallot } from "./lead-goal.ts";

const goal: LeadGoal = (parseLeadGoal(JSON.stringify({
  version: 1, id: "g1", goal: "go", metrics: ["m"],
  budget: { hours: 2, maxRounds: 5 }, stop: { success: "ok" },
  autonomy: 1, createdAt: 1_000_000,
})) as { ok: true; value: LeadGoal }).value;

function ballot(id: string, over: Partial<LeadTaskBallot> = {}): LeadTaskBallot {
  return {
    version: 1, id, goalId: "g1", title: id, reads: [], writes: [`out/${id}.txt`], locks: [],
    doneWhen: "done", role: "implementer", model: { instance: "claude", model: "m" }, dependsOn: [], ...over,
  };
}

describe("planLeadRound", () => {
  it("dispatches two independent tasks in one wave and the dependent one later", () => {
    const ballots = [ballot("a"), ballot("b"), ballot("c", { dependsOn: ["a", "b"] })];
    const p1 = planLeadRound(goal, ballots, [], { dispatched: [], verified: [] }, goal.createdAt + 1, 5);
    expect(p1.action).toBe("approve-and-dispatch");
    if (p1.action === "approve-and-dispatch") {
      expect(p1.wave.map((t) => t.id).sort()).toEqual(["a", "b"]);
      expect(p1.serialize).toEqual([]);
      expect(p1.round).toBe(1);
    }
    const p2 = planLeadRound(goal, ballots, [makeLedgerEntry(1, goal.createdAt + 2, { hypothesis: "h", config: "c", result: "r", decision: "continue", improved: true })], { dispatched: ["a", "b"], verified: ["a", "b"] }, goal.createdAt + 3, 5);
    expect(p2.action).toBe("approve-and-dispatch");
    if (p2.action === "approve-and-dispatch") expect(p2.wave.map((t) => t.id)).toEqual(["c"]);
  });
  it("marks conflicting tasks in the same wave to serialize", () => {
    const ballots = [ballot("a", { writes: ["same.txt"] }), ballot("b", { writes: ["same.txt"] })];
    const p = planLeadRound(goal, ballots, [], { dispatched: [], verified: [] }, goal.createdAt, 5);
    if (p.action === "approve-and-dispatch") expect(p.serialize).toEqual([["a", "b"]]);
  });
  it("does not dispatch a task whose dependency is not verified", () => {
    const ballots = [ballot("a"), ballot("c", { dependsOn: ["a"] })];
    const p = planLeadRound(goal, ballots, [], { dispatched: [], verified: [] }, goal.createdAt, 5);
    if (p.action === "approve-and-dispatch") expect(p.wave.map((t) => t.id)).toEqual(["a"]);
  });
  it("stops when budget is exhausted", () => {
    const p = planLeadRound(goal, [ballot("a")], [], { dispatched: [], verified: [] }, goal.createdAt + 3 * 3_600_000, 5);
    expect(p).toEqual({ action: "stop", reason: "budget-hours" });
  });
  it("stops on vendor violation", () => {
    const ballots = [ballot("i", { role: "implementer", model: { instance: "claude", model: "m" } }), ballot("e", { role: "evaluator", model: { instance: "claude", model: "m" }, writes: ["e.txt"] })];
    const p = planLeadRound(goal, ballots, [], { dispatched: [], verified: [] }, goal.createdAt, 5);
    expect(p.action).toBe("stop");
  });
});

describe("ledger jsonl", () => {
  it("round-trips", () => {
    const entries = [makeLedgerEntry(1, 100, { hypothesis: "h", config: "c", result: "r", decision: "continue", improved: true })];
    expect(parseLedgerJsonl(ledgerToJsonl(entries))).toEqual(entries);
  });
  it("parses empty", () => {
    expect(parseLedgerJsonl("")).toEqual([]);
  });
});
