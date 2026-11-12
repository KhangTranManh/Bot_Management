import { describe, expect, it } from "vitest";
import type { MemberNow } from "../../../shared/room-now";
import { foldLife } from "./use-office-life";

const row = (botId: string, patch: Partial<MemberNow> = {}): MemberNow => ({ botId, state: "running", task: "Build", threadId: `lane-${botId}`, ...patch });
const members = { g: ["a", "b"] };

describe("foldLife", () => {
  it("does not treat work already running on the first poll as just received", () => {
    const life = foldLife({}, { g: [row("a")] }, members, 1_000, true);
    expect(life["g:a"]).toMatchObject({ running: true });
    expect(life["g:a"]!.receivedAt).toBeUndefined();
    expect(life["g:b"]).toMatchObject({ running: false, idleSince: 1_000 });
  });

  it("notes a job that appears after the first poll, then keeps the time while it runs", () => {
    const idle = foldLife({}, { g: [] }, members, 1_000, true);
    const got = foldLife(idle, { g: [row("a", { step: "Read: x" })] }, members, 6_000, false);
    expect(got["g:a"]).toMatchObject({ running: true, receivedAt: 6_000, step: "Read: x", stepChangedAt: 6_000 });
    const later = foldLife(got, { g: [row("a", { step: "Read: x" })] }, members, 11_000, false);
    expect(later["g:a"]).toMatchObject({ receivedAt: 6_000, stepChangedAt: 6_000 });
    const moved = foldLife(later, { g: [row("a", { step: "Edit: x" })] }, members, 16_000, false);
    expect(moved["g:a"]).toMatchObject({ receivedAt: 6_000, stepChangedAt: 16_000, step: "Edit: x" });
  });

  it("notes the moment a running job ends and keeps when the bot went idle", () => {
    const running = foldLife({}, { g: [row("a")] }, members, 1_000, true);
    const done = foldLife(running, { g: [] }, members, 6_000, false);
    expect(done["g:a"]).toMatchObject({ running: false, finishedAt: 6_000, idleSince: 6_000 });
    const rested = foldLife(done, { g: [] }, members, 11_000, false);
    expect(rested["g:a"]).toMatchObject({ finishedAt: 6_000, idleSince: 6_000 });
  });

  it("returns the very same object when a poll shows nothing new", () => {
    const first = foldLife({}, { g: [row("a")] }, members, 1_000, true);
    expect(foldLife(first, { g: [row("a")] }, members, 6_000, false)).toBe(first);
  });
});
