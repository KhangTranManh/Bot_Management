import { describe, expect, it } from "vitest";
import { teamPlanProblem, testerVerdict, withTesterTask, withReviewTask } from "./team-roles.ts";

describe("testerVerdict", () => {
  it("reads the last verdict line, in any case, and nothing otherwise", () => {
    expect(testerVerdict("ran\nVERDICT: PASS")).toBe("pass");
    expect(testerVerdict("verdict: fail")).toBe("fail");
    expect(testerVerdict("VERDICT: FAIL then\nVERDICT: PASS")).toBe("pass");
    expect(testerVerdict("all good")).toBeUndefined();
  });
});

describe("withTesterTask", () => {
  const roleOf = (assignee: string) => ({ Builder: "worker", Checker: "tester" } as const)[assignee as "Builder" | "Checker"];
  it("adds one Tester task that waits on every Worker task and reads what they write", () => {
    const plan = withTesterTask([
      { id: "test", assignee: "Builder", instruction: "A", writes: ["a.ts"] },
      { id: "t2", assignee: "Builder", instruction: "B", writes: ["b.ts"] },
    ], roleOf, { id: "Checker" });
    expect(plan.at(-1)).toMatchObject({ id: "test-2", assignee: "Checker", dependsOn: ["test", "t2"], reads: ["a.ts", "b.ts"] });
  });
  it("leaves a plan alone without Worker tasks, with its own Tester task, or with no Tester", () => {
    const tested = [{ id: "t1", assignee: "Builder", instruction: "A", writes: ["a.ts"] }, { id: "t2", assignee: "Checker", instruction: "Test" }];
    expect(withTesterTask(tested, roleOf, { id: "Checker" })).toHaveLength(2);
    expect(withTesterTask([{ id: "t1", assignee: "Checker", instruction: "Test" }], roleOf, { id: "Checker" })).toHaveLength(1);
    expect(withTesterTask([tested[0]!], roleOf, undefined)).toHaveLength(1);
  });
});

describe("withReviewTask", () => {
  const roleOf = (id: string) => ({ w: "worker", t: "tester", r: "reviewer" } as const)[id as "w" | "t" | "r"];
  it("adds review after all work, alongside testing, without repeating test commands", () => {
    const tasks = withReviewTask(withTesterTask([
      { id: "review", assignee: "w", instruction: "A", writes: ["a.ts"] },
      { id: "b", assignee: "w", instruction: "B", writes: ["b.ts"] },
    ], roleOf, { id: "t" }), roleOf, { id: "r" });
    expect(tasks.at(-1)).toMatchObject({ id: "review-2", assignee: "r", reads: ["a.ts", "b.ts"], dependsOn: ["review", "b"] });
    expect(tasks.at(-1)!.instruction).toContain("Do not repeat the Tester's");
    expect(tasks.at(-1)!.dependsOn).not.toContain("test");
    expect(withReviewTask(tasks, roleOf, { id: "r" })).toEqual(tasks);
    expect(withReviewTask(tasks.slice(0, 2), roleOf, undefined)).toEqual(tasks.slice(0, 2));
    expect(withReviewTask([], roleOf, { id: "r" })).toEqual([]);
  });
});

describe("teamPlanProblem", () => {
  const roleOf = (botId: string) => ({ lead: "lead", w: "worker", t: "tester" } as const)[botId as "lead" | "w" | "t"];
  it("accepts work to Workers with writes and tests to Testers", () => {
    expect(teamPlanProblem([
      { plan: { id: "t1", assignee: "W", instruction: "A", writes: ["a.ts"] }, botId: "w", name: "W" },
      { plan: { id: "t2", assignee: "T", instruction: "Test" }, botId: "t", name: "T" },
    ], roleOf)).toBeUndefined();
  });
  it("names the task given to the Lead, to a member without a role, or to a Worker without writes", () => {
    expect(teamPlanProblem([{ plan: { id: "t1", assignee: "L", instruction: "A" }, botId: "lead", name: "L" }], roleOf)).toContain("who is the Lead");
    expect(teamPlanProblem([{ plan: { id: "t1", assignee: "X", instruction: "A" }, botId: "x", name: "X" }], roleOf)).toContain("not given a team role");
    expect(teamPlanProblem([{ plan: { id: "t1", assignee: "W", instruction: "A" }, botId: "w", name: "W" }], roleOf)).toContain("declares no writes");
  });
});
