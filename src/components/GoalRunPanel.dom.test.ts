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

  it("closes on Escape", () => {
    const onClose = vi.fn();
    flushSync(() => root.render(createElement(GoalRunPanel, { group: room([card]), cardId: "card", onClose })));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
