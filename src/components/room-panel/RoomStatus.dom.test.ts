// @vitest-environment happy-dom
// The team status card: each member's role as a choice, one lead at most, and presence as before.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

vi.mock("../Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, readAdvancedMode: () => false, setAdvancedMode: vi.fn() }));

const { RoomStatus, withRole } = await import("./RoomStatus");

const bot = (id: string, name: string): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "m" },
});
const members = [bot("a", "Ada"), bot("b", "Bo")];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("withRole", () => {
  it("sets, clears, and moves the single lead", () => {
    expect(withRole(undefined, "a", "worker")).toEqual({ a: "worker" });
    expect(withRole({ a: "worker" }, "a", "")).toEqual({});
    expect(withRole({ a: "lead", b: "worker" }, "b", "lead")).toEqual({ b: "lead" });
  });
});

describe("RoomStatus roles", () => {
  it("offers each member's role as a choice and reports the new roles", () => {
    const onRoles = vi.fn();
    flushSync(() => root.render(createElement(RoomStatus, { group: { messages: [], roles: { a: "lead" } }, members, onRoles })));
    const select = document.querySelector<HTMLSelectElement>('[data-role-select="b"]')!;
    expect(document.querySelector<HTMLSelectElement>('[data-role-select="a"]')!.value).toBe("lead");
    select.value = "tester";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onRoles).toHaveBeenCalledWith({ a: "lead", b: "tester" });
  });

  it("shows roles as labels where they cannot be changed", () => {
    flushSync(() => root.render(createElement(RoomStatus, { group: { messages: [], roles: { b: "reviewer" } }, members })));
    expect(document.querySelector("[data-role-select]")).toBeNull();
    expect(document.querySelector('[data-status-row="b"] [data-role="reviewer"]')).not.toBeNull();
  });

  it("shows each member's job now, its newest step and how long it has run, and counts a running job as working", () => {
    const now = [
      { botId: "a", state: "running" as const, task: "Build the UI", threadId: "lane-a", since: Date.now() - 40_000, step: "Edit: ui.tsx", stepOk: true },
      { botId: "b", state: "queued" as const, task: "Test it", threadId: "lane-b" },
    ];
    flushSync(() => root.render(createElement(RoomStatus, { group: { messages: [] }, members, now })));
    const a = document.querySelector('[data-now-row="a"]')!;
    expect(a.textContent).toContain("Build the UI");
    expect(a.textContent).toMatch(/4\d s/);
    expect(a.textContent).toContain("Edit: ui.tsx");
    expect(document.querySelector('[data-status-row="a"]')!.getAttribute("data-presence")).toBe("working");
    expect(document.querySelector('[data-now-row="b"]')!.getAttribute("data-now-state")).toBe("queued");
    expect(document.querySelector('[data-status-row="b"]')!.getAttribute("data-presence")).toBe("idle");
  });
});
