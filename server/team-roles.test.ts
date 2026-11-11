import { describe, expect, it } from "vitest";
import { owningTask, reviewReport, teamPlanProblem, testerFailures, testerVerdict, withTesterTask, withReviewTask, workPlan } from "./team-roles.ts";

describe("testerVerdict", () => {
  it("reads the last verdict line, in any case, and nothing otherwise", () => {
    expect(testerVerdict("ran\nVERDICT: PASS")).toBe("pass");
    expect(testerVerdict("verdict: fail")).toBe("fail");
    expect(testerVerdict("VERDICT: FAIL then\nVERDICT: PASS")).toBe("pass");
    expect(testerVerdict("all good")).toBeUndefined();
  });
});

describe("testerFailures", () => {
  it("reads each FAIL line's file or test without its line number, never the verdict line", () => {
    expect(testerFailures("FAIL: src/a.ts:12:4 — boom\n  fail: test_total — off by one\nFAIL: src/a.ts — again\nVERDICT: FAIL")).toEqual(["src/a.ts", "test_total"]);
    expect(testerFailures("All green.\nVERDICT: PASS")).toEqual([]);
  });
});

describe("reviewReport", () => {
  it("reads findings with or without a task id, and the last closing line", () => {
    const report = reviewReport([
      "FINDING: block t1 src/cart.ts:40 — total ignores the discount",
      "FINDING: fix src/cart.ts - rename the helper",
      "FINDING: note looks tidy",
      "REVIEW: CLEAR", "REVIEW: BLOCK 1",
    ].join("\n"));
    expect(report).toEqual({ end: "block", blocking: true, findings: [
      { level: "block", task: "t1", file: "src/cart.ts", text: "total ignores the discount" },
      { level: "fix", file: "src/cart.ts", text: "rename the helper" },
      { level: "note", text: "looks tidy" },
    ] });
  });
  it("blocks on a block finding even under REVIEW: CLEAR, and not on fix or note alone", () => {
    expect(reviewReport("FINDING: block t2 a.ts — wrong\nREVIEW: CLEAR").blocking).toBe(true);
    expect(reviewReport("FINDING: fix t2 a.ts — tidy\nREVIEW: CLEAR")).toMatchObject({ end: "clear", blocking: false });
    expect(reviewReport("Reviewed, no findings.")).toEqual({ findings: [], blocking: false });
  });
});

describe("owningTask", () => {
  const tasks = [{ id: "t1", writes: ["src/cart.ts"] }, { id: "t2", writes: ["total.ts"] }, { id: "t3" }];
  it("prefers the named task, then the task whose writes name the file by path tail", () => {
    expect(owningTask(tasks, "src/cart.ts", "t2")?.id).toBe("t2");
    expect(owningTask(tasks, "lib/total.ts")?.id).toBe("t2");
    expect(owningTask(tasks, "cart.ts")?.id).toBe("t1");
    expect(owningTask(tasks, "other.ts")).toBeUndefined();
    expect(owningTask(tasks)).toBeUndefined();
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
  it("adds no second Tester task, and leaves a plan alone without Worker tasks or without a Tester", () => {
    const tested = [{ id: "t1", assignee: "Builder", instruction: "A", writes: ["a.ts"] }, { id: "t2", assignee: "Checker", instruction: "Test" }];
    expect(withTesterTask(tested, roleOf, { id: "Checker" })).toHaveLength(2);
    expect(withTesterTask([{ id: "t1", assignee: "Checker", instruction: "Test" }], roleOf, { id: "Checker" })).toEqual([{ id: "t1", assignee: "Checker", instruction: "Test" }]);
    expect(withTesterTask([tested[0]!], roleOf, undefined)).toEqual([tested[0]]);
  });
  it("gives every Tester task the Lead's plan, its own or the added one", () => {
    const work = { id: "t1", assignee: "Builder", instruction: "Fix the  total\nrounding", writes: ["src/orders.js"] };
    const nameOf = (assignee: string) => (assignee === "Builder" ? "Luna" : undefined);
    const line = "- t1 · Luna · Fix the total rounding · src/orders.js";
    expect(withTesterTask([work], roleOf, { id: "Checker" }, { nameOf }).at(-1)!.instruction).toContain(`\nThe Lead's plan for the work you test (task · Worker · what it does · files):\n${line}`);
    expect(withTesterTask([work, { id: "c", assignee: "Checker", instruction: "Run npm test" }], roleOf, { id: "Checker" }, { nameOf })[1]!.instruction)
      .toBe(`Run npm test\nThe Lead's plan for the work you test (task · Worker · what it does · files):\n${line}`);
  });
});

describe("acceptance checks", () => {
  it("follow the plan in every check task, and stay out when the brief has none", () => {
    const roleOf = (assignee: string) => ({ w: "worker", t: "tester", r: "reviewer" } as const)[assignee as "w" | "t" | "r"];
    const work = [{ id: "t1", assignee: "w", instruction: "Cart", writes: ["src/cart.js"] }];
    const acceptance = ["Adding beyond stock returns 409", "Totals match SPEC.md"];
    const tested = withTesterTask(work, roleOf, { id: "t" }, { acceptance });
    const reviewed = withReviewTask([...work, { id: "r1", assignee: "r", instruction: "Review" }], roleOf, { id: "r" }, { acceptance });
    const tail = "\nAcceptance checks from the run's brief:\n- Adding beyond stock returns 409\n- Totals match SPEC.md";
    expect(tested.at(-1)!.instruction.endsWith(tail)).toBe(true);
    expect(reviewed[1]!.instruction.endsWith(tail)).toBe(true);
    expect(withTesterTask(work, roleOf, { id: "t" }, { acceptance: [] }).at(-1)!.instruction).not.toContain("Acceptance checks");
  });
});

describe("workPlan", () => {
  it("shortens a long assignment and names undeclared files, falling back to the assignee", () => {
    const long = "x".repeat(200);
    expect(workPlan([{ id: "t1", assignee: "w-id", instruction: long }], () => undefined)).toBe(`- t1 · w-id · ${"x".repeat(159)}… · no declared files`);
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
    expect(withReviewTask(tasks, roleOf, { id: "r" })).toHaveLength(tasks.length);
    expect(withReviewTask(tasks.slice(0, 2), roleOf, undefined)).toEqual(tasks.slice(0, 2));
    expect(withReviewTask([], roleOf, { id: "r" })).toEqual([]);
  });
  it("gives a review task the Lead wrote itself the Lead's plan, by member name", () => {
    const names: Record<string, string> = { w: "Terra" };
    const plan = withReviewTask([
      { id: "t1", assignee: "w", instruction: "Fix orders", writes: ["src/orders.js", "src/report.js"] },
      { id: "t2", assignee: "x", instruction: "Notes" },
      { id: "check", assignee: "r", instruction: "Review git diff", dependsOn: ["t1"] },
    ], roleOf, { id: "r" }, { nameOf: (assignee) => names[assignee] });
    expect(plan).toHaveLength(3);
    expect(plan[2]!.instruction).toBe("Review git diff\nThe Lead's plan for the work you review (task · Worker · what it does · files); name the task id in each finding:\n- t1 · Terra · Fix orders · src/orders.js, src/report.js");
    expect(plan.slice(0, 2)).toEqual([
      { id: "t1", assignee: "w", instruction: "Fix orders", writes: ["src/orders.js", "src/report.js"] },
      { id: "t2", assignee: "x", instruction: "Notes" },
    ]);
  });
  it("leaves a review-only plan as the Lead wrote it", () => {
    const plan = [{ id: "check", assignee: "r", instruction: "Review the baseline" }];
    expect(withReviewTask(plan, roleOf, { id: "r" })).toEqual(plan);
  });
});

describe("teamPlanProblem", () => {
  const roleOf = (botId: string) => ({ lead: "lead", w: "worker", t: "tester", r: "reviewer" } as const)[botId as "lead" | "w" | "t" | "r"];
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
  it("refuses a Tester or Reviewer task that declares writes, and allows one with an empty list", () => {
    expect(teamPlanProblem([{ plan: { id: "t3", assignee: "T", instruction: "Write the tests", writes: ["tests/"] }, botId: "t", name: "T" }], roleOf))
      .toBe("task t3 for Tester T declares writes (tests/); Testers and Reviewers change no files, so give writing code or tests to a Worker");
    expect(teamPlanProblem([{ plan: { id: "r1", assignee: "R", instruction: "Fix as you review", writes: ["a.ts"] }, botId: "r", name: "R" }], roleOf)).toContain("Reviewer R declares writes");
    expect(teamPlanProblem([{ plan: { id: "t3", assignee: "T", instruction: "Run the tests", writes: [] }, botId: "t", name: "T" }], roleOf)).toBeUndefined();
  });
});
