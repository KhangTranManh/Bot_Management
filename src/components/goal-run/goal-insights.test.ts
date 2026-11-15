import { describe, expect, it } from "vitest";
import type { Group, Message } from "@/state/store";
import { goalMessages, goalReports } from "./goal-insights";
import { goalAwaitsConfirmation } from "./GoalConfirm";

const message = (id: string, patch: Partial<Message>): Message => ({ id, at: 1, role: "bot", kind: "text", ...patch });
const goal = (id: string, status: "working" | "needs-input" | "completed" | "failed" = "working") => message(id, {
  kind: "goal.run",
  goalRun: { runId: id, goal: "Build", status, coordinatorBotId: "lead", coordinatorName: "Lead", turnCount: 1, maxTurns: 13, startedAt: 1 },
});
const room = (id: string, messages: Message[] = []) => ({ id, memberIds: ["worker", "tester"], messages, roles: { tester: "tester" } } as unknown as Group);

describe("goal insights stay inside the selected run", () => {
  it("excludes messages before this goal and after the next goal", () => {
    const rows = [message("before", {}), goal("a"), message("pass", { from: { botId: "tester", name: "Tester", color: "blue" }, text: "VERDICT: FAIL\nVERDICT: PASS" }), goal("b"), message("later", {})];
    expect(goalMessages(rows, "a").map((row) => row.id)).toEqual(["pass"]);
    expect(goalMessages(rows, "missing")).toEqual([]);
    expect(goalReports(room("r", rows), "a").map((report) => report.verdict)).toEqual(["PASS"]);
  });
});

describe("a goal that stopped for the person", () => {
  it("offers confirmation only while it waits on the person", () => {
    for (const status of ["needs-input", "paused", "limit-reached"] as const) {
      const waiting = goal("g", "needs-input");
      waiting.goalRun = { ...waiting.goalRun!, status };
      expect(goalAwaitsConfirmation(waiting)).toBe(true);
    }
    for (const status of ["working", "completed", "failed"] as const) expect(goalAwaitsConfirmation(goal("g", status))).toBe(false);
  });
  it("offers nothing for a message that is not a goal", () => {
    expect(goalAwaitsConfirmation(message("plain", {}))).toBe(false);
    expect(goalAwaitsConfirmation(undefined)).toBe(false);
  });
});
