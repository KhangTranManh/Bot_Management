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
});
