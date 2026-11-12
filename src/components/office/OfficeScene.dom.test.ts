// @vitest-environment happy-dom
// The office floor in a real DOM: no lines or arrows, zones by role, tickets, desk screens and faces that follow the work.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import type { MemberNow } from "../../../shared/room-now";

vi.mock("../Avatar", () => ({
  BotAvatar: ({ state, animated, gaze }: { state?: string; animated?: boolean; gaze?: unknown }) =>
    createElement("i", { "data-face": state, "data-animated": String(animated), "data-gaze": gaze ? "yes" : "no" }),
}));

const { OfficeScene } = await import("./OfficeScene");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = (id: string, name: string, over: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color: "green", notifications: true, unread: false, busy: false,
  messages: [], modelSelection: { instanceId: "test", model: "m" }, ...over,
});
const bots = [bot("lead", "Lead"), bot("w1", "Terra"), bot("t1", "Tester"), bot("chief", "Chief", { chiefOfStaff: true })];
const group = (over: Partial<Group> = {}): Group => ({
  id: "g", threadId: "g-thread", name: "Inventory", description: "", memberIds: ["lead", "w1", "t1"], defaultResponder: { kind: "member", botId: "lead" },
  bulletin: "", unread: false, createdAt: 1, setupCompletedAt: 1, messages: [], kind: "code",
  roles: { lead: "lead", w1: "worker", t1: "tester" }, ...over,
} as Group);
const run = (botId: string, over: Partial<MemberNow> = {}): MemberNow => ({ botId, state: "running", task: "Build the cart", threadId: `lane-${botId}`, since: Date.now(), ...over });

let host: HTMLDivElement;
let root: Root;
const render = async (jobs: Record<string, MemberNow[]>, groups: Group[] = [group()]) => {
  await act(async () => root.render(createElement(OfficeScene, { groups, bots, jobs, select: vi.fn(), openRoom: vi.fn() })));
};
const faceOf = (botName: string) => [...host.querySelectorAll(".office-bot")].find((el) => el.getAttribute("aria-label")?.startsWith(botName))?.querySelector("[data-face]")?.getAttribute("data-face");

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OfficeScene", () => {
  it("draws no lines, arrows or beams at rest, only zones by role, and every bot idle", async () => {
    await render({ g: [] });
    expect(host.querySelectorAll("path[marker-end], .office-link, .office-role-link, .office-beam, marker").length).toBe(0);
    expect([...host.querySelectorAll("[data-office-zone]")].map((el) => el.getAttribute("data-office-zone"))).toEqual(["LEAD", "WORKERS", "KIỂM TRA"]);
    expect(host.querySelector("[data-office-hop]")).toBeNull();
    expect(host.querySelectorAll(".office-screen.is-on").length).toBe(0);
    expect(["Lead", "Terra", "Tester"].map(faceOf)).toEqual(["idle", "idle", "idle"]);
  });

  it("skips the zones in a room with no roles", async () => {
    await render({ g: [] }, [group({ roles: {} })]);
    expect(host.querySelector("[data-office-zone]")).toBeNull();
  });

  it("shows a bot already at work with its step's face, its screen on and no flying ticket", async () => {
    await render({ g: [run("w1", { step: "Edit: web/ui.tsx" })] });
    expect(faceOf("Terra")).toBe("writing");
    expect(host.querySelectorAll(".office-screen.is-on").length).toBe(1);
    expect(host.querySelector("[data-office-hop]")).toBeNull();
  });

  it("flies one ticket to a bot that takes a job after the first poll, and gives it the receiving face", async () => {
    await render({ g: [] });
    await render({ g: [run("w1", { step: "Read: a.ts" })] });
    expect(host.querySelectorAll("[data-office-hop]").length).toBe(1);
    expect(host.querySelector("[data-office-hop] text")?.textContent).toBe("Build the cart");
    await act(async () => { vi.advanceTimersByTime(1_600); });
    expect(faceOf("Terra")).toBe("receiving");
    for (let second = 0; second < 6; second++) await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(faceOf("Terra")).toBe("searching");
    expect(host.querySelector("[data-office-hop]")).toBeNull();
  });

  it("lets the Lead watch the Worker, and the Worker the Lead", async () => {
    await render({ g: [run("w1", { step: "npm test" })] });
    const gazeOf = (name: string) => [...host.querySelectorAll(".office-bot")].find((el) => el.getAttribute("aria-label")?.startsWith(name))?.querySelector("[data-gaze]")?.getAttribute("data-gaze");
    expect(gazeOf("Lead")).toBe("yes");
    expect(gazeOf("Terra")).toBe("yes");
    expect(gazeOf("Tester")).toBe("no");
  });

  it("stacks tickets for a queued bot and shows its listening face", async () => {
    await render({ g: [run("t1", { state: "queued" })] });
    expect(faceOf("Tester")).toBe("listening");
    expect(host.querySelectorAll(".office-ticket.is-queued").length).toBe(3);
  });

  it("names a bot once on its plate, leaves its role to the floor zone, and keeps the role in its label", async () => {
    await render({ g: [] });
    const terra = [...host.querySelectorAll(".office-bot")].find((el) => el.getAttribute("aria-label")?.startsWith("Terra"))!;
    expect(terra.querySelector(".office-pill-name")?.textContent).toBe("Terra");
    expect(terra.querySelector(".office-pill-role")).toBeNull();
    expect(terra.getAttribute("aria-label")).toContain("Worker");
  });

  it("puts a badge beside each busy bot's head that says what it is doing, and none on an idle one", async () => {
    await render({ g: [run("w1", { step: "Edit: web/ui.tsx" }), run("t1", { state: "queued" })] });
    const badgeOf = (name: string) => [...host.querySelectorAll(".office-bot")].find((el) => el.getAttribute("aria-label")?.startsWith(name))?.querySelector("[data-badge]")?.getAttribute("data-badge");
    expect(badgeOf("Terra")).toBe("writing");
    expect(badgeOf("Tester")).toBe("listening");
    expect(badgeOf("Lead")).toBeUndefined();
  });

  it("stops the motion for someone who asks for none: no flying ticket, mascots not animated", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    await render({ g: [] });
    await render({ g: [run("w1")] });
    expect(host.querySelector("[data-office-hop]")).toBeNull();
    expect(host.querySelector("[data-face]")?.getAttribute("data-animated")).toBe("false");
    expect(host.querySelectorAll(".office-ticket").length).toBe(1);
  });

  it("makes a room celebrate when its goal has just completed", async () => {
    const goalRun = { runId: "r", goal: "Ship", status: "completed" as const, coordinatorBotId: "lead", coordinatorName: "Lead", turnCount: 4, maxTurns: 13, startedAt: 1, finishedAt: Date.now() };
    await render({ g: [] }, [group({ messages: [{ id: "c", role: "bot", kind: "goal.run", at: 1, goalRun }] as never })]);
    expect(["Lead", "Terra", "Tester"].map(faceOf)).toEqual(["celebrate", "celebrate", "celebrate"]);
  });
});
