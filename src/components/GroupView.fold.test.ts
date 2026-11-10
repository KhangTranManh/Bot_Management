// @vitest-environment happy-dom
// A long bot reply in a room folds to its opening with Show full, and opens again; a short one and the person's lines do not fold this way.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group, Message } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: [] as Bot[] }, dispatch: vi.fn() }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));

const { Transcript, botReplyFolds } = await import("./GroupView");

const lead = { id: "lead", name: "Lead", color: "blue", voice: "verse" } as Bot;
const room = { id: "room", threadId: "room-thread", name: "Launch", memberIds: ["lead"], defaultResponder: { kind: "member", botId: "lead" }, bulletin: "", unread: false, createdAt: 1, messages: [] as Message[] } as Group;
const reply = (id: string, body: string): Message => ({ id, role: "bot", kind: "text", at: 1, text: body, from: { botId: "lead", name: "Lead", color: "blue" } });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("long bot replies in a room", () => {
  it("fold past twelve hundred characters or sixteen lines", () => {
    expect(botReplyFolds("short")).toBe(false);
    expect(botReplyFolds("x".repeat(1_201))).toBe(true);
    expect(botReplyFolds(Array(17).fill("line").join("\n"))).toBe(true);
  });

  it("show the opening with Show full, and open on click", () => {
    const messages = [reply("long", Array(30).fill("- a finding").join("\n")), reply("short", "Done.")];
    flushSync(() => root.render(createElement(Transcript, { group: { ...room, messages }, members: [lead], locale: "en", messages, transcript: messages, onReply: () => {} })));
    expect(document.querySelectorAll("[data-bot-folded]")).toHaveLength(1);
    const toggle = document.querySelector<HTMLButtonElement>("[data-bot-fold-toggle]")!;
    flushSync(() => toggle.click());
    expect(document.querySelectorAll("[data-bot-folded]")).toHaveLength(0);
    expect(document.querySelector("[data-bot-fold-toggle]")).not.toBeNull();
  });
});
