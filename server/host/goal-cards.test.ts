import { describe, expect, it } from "vitest";
import type { GoalConflict } from "../../shared/group-goal-run.ts";
import "../server-line-packs.ts";
import type { Message } from "../store.ts";
import { createGoalCards } from "./goal-cards.ts";

const lead = { id: "lead", name: "Lead", color: "red" as const };

function cards() {
  const lines: Message[] = [];
  const store = {
    appendMessage: (_threadId: string, message: Omit<Message, "id" | "at">) => { const full = { id: `m${lines.length + 1}`, at: 1, ...message } as Message; lines.push(full); return full; },
    bot: () => null,
    messagesFor: () => lines,
    patchMessage: (_threadId: string, id: string, patch: Partial<Message>) => { const line = lines.find((one) => one.id === id)!; Object.assign(line, patch); return line; },
  };
  return { lines, goals: createGoalCards({ store: store as never, routines: () => null, notify: () => {}, routineSourceOwner: () => null, routineSourceThread: () => null }) };
}

const conflict = (n: number): GoalConflict => ({
  file: `src/f${n}.js`, ownerTask: "t1", ownerBotId: "a", ownerName: "A", otherTask: "t2", otherBotId: "b", otherName: "B", steered: true, at: n,
});

describe("goal cards keep the brief and the conflicts", () => {
  it("through progress and the finish, with secrets taken out of the brief", () => {
    const { lines, goals } = cards();
    const run = goals.start("room", lead, "Ship checkout", "run-1");
    goals.brief("room", run, { goal: "Ship checkout", inScope: ["cart"], outOfScope: [], acceptance: ["token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 stays out"], constraints: [], openQuestions: [] });
    expect(lines[0]!.goalRun?.brief?.goal).toBe("Ship checkout");
    expect(lines[0]!.goalRun?.brief?.acceptance[0]).not.toContain("abcdefghijklmnopqrstuvwxyz");
    goals.conflict("room", run, conflict(1));
    goals.baseline("room", run, { startedAt: 1, finishedAt: 2, setup: [], checks: [{ id: "tests", exitCode: 1, expectExit: 0, output: "token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }] });
    expect(lines[0]!.goalRun?.baseline?.checks[0]?.output).not.toContain("abcdefghijklmnopqrstuvwxyz");
    goals.progress("room", run, "Lead is on turn 3");
    expect(lines[0]!.goalRun).toMatchObject({ status: "working", brief: { goal: "Ship checkout" }, conflicts: [{ file: "src/f1.js" }] });
    goals.finish("room", run, "completed", "Done.", () => true);
    expect(lines[0]!.goalRun).toMatchObject({ status: "completed", brief: { inScope: ["cart"] }, conflicts: [{ file: "src/f1.js" }] });
    expect(lines[0]!.goalRun?.baseline).toMatchObject({ checks: [{ id: "tests", exitCode: 1 }] });
    goals.conflict("room", run, conflict(2));
    expect(lines[0]!.goalRun?.conflicts).toHaveLength(1);
  });

  it("keeps the latest twenty conflicts", () => {
    const { lines, goals } = cards();
    const run = goals.start("room", lead, "Ship checkout", "run-1");
    for (let n = 1; n <= 25; n++) goals.conflict("room", run, conflict(n));
    expect(lines[0]!.goalRun?.conflicts?.map((one) => one.at)).toEqual(Array.from({ length: 20 }, (_, i) => i + 6));
  });
});
