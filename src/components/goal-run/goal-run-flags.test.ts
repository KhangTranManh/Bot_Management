import { describe, expect, it } from "vitest";
import type { GroupGoalRunCardData } from "../../../shared/group-goal-run";
import { goalRunFlags } from "./GoalRunRecord";

const run: GroupGoalRunCardData = { runId: "r", goal: "Ship", status: "working", coordinatorBotId: "lead", coordinatorName: "Lead", turnCount: 1, maxTurns: 13, startedAt: 1 };

describe("goal card flags", () => {
  it("is empty for a plain run and a clean brief and baseline", () => {
    expect(goalRunFlags(run)).toEqual([]);
    expect(goalRunFlags({ ...run, brief: { goal: "Ship", inScope: [], outOfScope: [], acceptance: [], constraints: [], openQuestions: [] }, baseline: { startedAt: 1, finishedAt: 2, setup: [], checks: [{ id: "t", exitCode: 0, expectExit: 0, output: "" }] } })).toEqual([]);
  });

  it("counts open questions, conflicts and baseline commands that missed their exit code", () => {
    expect(goalRunFlags({
      ...run,
      brief: { goal: "Ship", inScope: [], outOfScope: [], acceptance: [], constraints: [], openQuestions: ["a", "b"] },
      conflicts: [{ file: "f", ownerTask: "t1", ownerBotId: "a", ownerName: "A", otherTask: "t2", otherBotId: "b", otherName: "B", steered: true, at: 1 }],
      baseline: { startedAt: 1, finishedAt: 2, setup: [{ id: "s", exitCode: null, expectExit: 0, output: "" }], checks: [{ id: "t", exitCode: 1, expectExit: 1, output: "" }] },
    })).toEqual(["2 câu hỏi mở", "1 conflict", "gốc 1 lệnh lỗi"]);
  });
});
