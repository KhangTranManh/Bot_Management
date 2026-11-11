import { describe, expect, it, vi } from "vitest";
import type { Bot, Group, Message } from "@/state/store";
import { latestGoal, officeNeeds, officeRooms, officeSeats, officeState, pendingCards } from "./office-model";
import { goalMessages, goalReports } from "./goal-insights";

const message = (id: string, patch: Partial<Message>): Message => ({ id, at: 1, role: "bot", kind: "text", ...patch });
const goal = (id: string, status: "working" | "needs-input" = "working") => message(id, { kind: "goal.run", goalRun: { runId: id, goal: "Build", status, coordinatorBotId: "lead", coordinatorName: "Lead", startedAt: 1, turnCount: 1, maxTurns: 13 } });
const room = (id: string, messages: Message[] = []) => ({ id, memberIds: ["worker", "tester"], messages, roles: { tester: "tester" } } as unknown as Group);

describe("Office uses the existing room snapshot", () => {
  it("counts only pending cards and the latest goal's request for input", () => {
    const pending = message("pending", { kind: "options", card: { title: "Duyệt lệnh", subtitle: "npm test", options: ["Allow"] } });
    const resolved = message("resolved", { ...pending, id: "resolved", card: { ...pending.card!, answered: "Allow" } });
    const expired = message("expired", { ...pending, id: "expired", card: { ...pending.card!, expired: true } });
    const group = room("a", [goal("old", "needs-input"), pending, resolved, expired, goal("new")]);
    expect(latestGoal(group)?.runId).toBe("new");
    expect(pendingCards(group.messages).map((row) => row.id)).toEqual(["pending"]);
    expect(officeNeeds([group]).map((need) => need.id)).toEqual(["pending"]);
    expect(officeRooms([group, { ...group, id: "dm", dm: true }])).toEqual([group]);
  });
  it("does not claim a bot is working in this room just because it is busy somewhere else", () => {
    const bot = { messages: [], busy: true, activity: "working" } as unknown as Bot;
    expect(officeState(bot)).toBe("idle");
    expect(officeState(bot, { botId: "b", state: "running", task: "Build", threadId: "lane" })).toBe("running");
    expect(officeState(bot, { botId: "b", state: "queued", task: "Build", threadId: "lane" })).toBe("queued");
  });
  it("uses a reported quota reset rather than inventing an unavailable state", () => {
    const bot = { messages: [message("quota", { kind: "activity", tool: { name: "Quota", limitResetsAt: 1001 } })] } as unknown as Bot;
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try { expect(officeState(bot)).toBe("out"); now.mockReturnValue(1002); expect(officeState(bot)).toBe("idle"); }
    finally { now.mockRestore(); }
  });
});

describe("Office seats follow the team's coordination order", () => {
  it("puts the Lead before Workers and every check role after them", () => {
    const bots = ["tester", "w1", "spare", "reviewer", "lead", "w2"].map((id) => ({ id }));
    const roles = { lead: "lead", w1: "worker", w2: "worker", tester: "tester", reviewer: "reviewer" };
    const seats = officeSeats(bots, roles);
    expect(seats.map(({ bot, stage }) => `${bot.id}:${stage}`)).toEqual(["lead:lead", "spare:lead", "w1:work", "w2:work", "tester:check", "reviewer:check"]);
    expect(new Set(seats.map(({ x, y }) => `${x},${y}`)).size).toBe(bots.length);
  });
  it("keeps a room without roles on a plain grid", () => {
    expect(officeSeats([{ id: "a" }, { id: "b" }]).every((seat) => !seat.stage)).toBe(true);
  });
});

describe("goal insights stay inside the selected run", () => {
  it("excludes messages before this goal and after the next goal", () => {
    const rows = [message("before", {}), goal("a"), message("pass", { from: { botId: "tester", name: "Tester", color: "blue" }, text: "VERDICT: FAIL\nVERDICT: PASS" }), goal("b"), message("later", {})];
    expect(goalMessages(rows, "a").map((row) => row.id)).toEqual(["pass"]);
    expect(goalMessages(rows, "missing")).toEqual([]);
    expect(goalReports(room("r", rows), "a").map((report) => report.verdict)).toEqual(["PASS"]);
  });
});
