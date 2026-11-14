// @vitest-environment happy-dom
// The goal panel in a real DOM: the run's turn, the lead as coordinating, and the team's lines since the card.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group, Message } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixtureBots } as AppState, dispatch: vi.fn() }) };
});
vi.mock("./Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ dragProps: {}, padClass: "" }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, readAdvancedMode: () => false, setAdvancedMode: vi.fn() }));

const bot = (id: string, name: string, busy = false): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color: "green",
  notifications: true, unread: false, busy, messages: [], modelSelection: { instanceId: "test", model: "m" },
});
const fixtureBots = [bot("lead", "Lead"), bot("worker", "Worker", true)];
const { GoalRunPanel } = await import("./GoalRunPanel");

const row = (id: string, patch: Partial<Message>): Message => ({ id, role: "bot", kind: "text", at: 1_000, ...patch } as Message);
const room = (messages: Message[]): Group => ({
  id: "g", threadId: "g-thread", name: "Team", description: "", memberIds: ["lead", "worker"],
  defaultResponder: { kind: "member", botId: "lead" }, bulletin: "", unread: false, createdAt: 1, setupCompletedAt: 1, messages,
});
const card = row("card", { kind: "goal.run", goalRun: { runId: "r", goal: "Ship it", status: "working", coordinatorBotId: "lead", coordinatorName: "Lead", turnCount: 1, maxTurns: 13, startedAt: 1 } });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("GoalRunPanel", () => {
  it("shows the turn, the lead coordinating, the busy worker and only lines after the card", () => {
    const group = room([
      row("before", { text: "older line" }),
      card,
      row("a", { text: "Worker started the API", from: { botId: "worker", name: "Worker", color: "green" } }),
    ]);
    flushSync(() => root.render(createElement(GoalRunPanel, { group, cardId: "card", onClose: vi.fn() })));
    const panel = document.querySelector("[data-goal-run-panel]")!;
    expect(panel.textContent).toContain("Ship it");
    expect(panel.querySelector('[data-status-row="lead"]')?.getAttribute("data-presence")).toBe("coordinating");
    expect(panel.querySelector('[data-status-row="worker"]')?.getAttribute("data-presence")).toBe("working");
    expect([...panel.querySelectorAll("[data-goal-feed-row]")].map((el) => el.textContent)).toEqual([expect.stringContaining("Worker started the API")]);
    expect(panel.textContent).not.toContain("older line");
  });

  it("shows the brief, the baseline and the conflicts the run carries", () => {
    const recorded = row("card", { kind: "goal.run", goalRun: {
      ...card.goalRun!, status: "needs-input",
      brief: { goal: "Ship checkout", inScope: ["cart"], outOfScope: ["payments"], acceptance: ["POST /orders returns 201"], constraints: [], openQuestions: ["Which currency?"],
        structure: [{ name: "frontend", paths: ["web/src"], owns: "screens" }, { name: "tests", paths: ["tests"], owns: "contract tests", readOnly: true }] },
      baseline: { startedAt: 1, finishedAt: 2, setup: [{ id: "install", exitCode: 0, expectExit: 0, output: "" }], checks: [{ id: "tests", exitCode: 1, expectExit: 0, output: "1 failing" }] },
      conflicts: [{ file: "src/cart.js", ownerTask: "t1", ownerBotId: "worker", ownerName: "Worker", otherTask: "t2", otherBotId: "lead", otherName: "Lead", steered: false, at: 3 }],
    } });
    flushSync(() => root.render(createElement(GoalRunPanel, { group: room([recorded]), cardId: "card", onClose: vi.fn() })));
    const panel = document.querySelector("[data-goal-run-panel]")!;
    expect(panel.querySelector('[data-goal-brief-list="Câu hỏi mở"]')?.textContent).toContain("Which currency?");
    expect(panel.querySelector("[data-goal-brief]")?.textContent).toContain("POST /orders returns 201");
    expect(panel.querySelector('[data-goal-brief-list="Ràng buộc"]')).toBeNull();
    expect([...panel.querySelectorAll("[data-goal-area]")].map((el) => [el.getAttribute("data-goal-area"), el.getAttribute("data-read-only"), el.querySelector("code")?.textContent]))
      .toEqual([["frontend", "false", "web/src"], ["tests", "true", "tests"]]);
    expect(panel.querySelector('[data-goal-area="tests"]')?.textContent).toContain("chỉ đọc");
    expect(panel.querySelector("[data-goal-baseline]")?.textContent).toContain("1/2 lệnh đạt");
    expect(panel.querySelector('[data-goal-check="tests"]')?.getAttribute("data-passed")).toBe("false");
    expect(panel.querySelector('[data-goal-conflict="src/cart.js"]')?.textContent).toContain("Lead (t2) sửa file của Worker (t1)");
  });

  it("shows no record section for a run without one", () => {
    flushSync(() => root.render(createElement(GoalRunPanel, { group: room([card]), cardId: "card", onClose: vi.fn() })));
    expect(document.querySelector(".goal-run-record")).toBeNull();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    flushSync(() => root.render(createElement(GoalRunPanel, { group: room([card]), cardId: "card", onClose })));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
