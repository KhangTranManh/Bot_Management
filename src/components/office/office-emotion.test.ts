import { describe, expect, it } from "vitest";
import { CELEBRATE_MS, DROWSY_MS, RECEIVE_MS, SEND_MS, SLEEP_MS, officeEmotion, stepKind } from "./office-emotion";

describe("stepKind", () => {
  it("reads a step's wording as reading, writing or running", () => {
    expect(stepKind("Read: src/cart.js")).toBe("read");
    expect(stepKind("Grep: total")).toBe("read");
    expect(stepKind("Edit: web/ui.tsx")).toBe("write");
    expect(stepKind("Write src/new.ts")).toBe("write");
    expect(stepKind("npm test")).toBe("run");
    expect(stepKind("")).toBeUndefined();
    expect(stepKind(undefined)).toBeUndefined();
  });
});

describe("officeEmotion", () => {
  const running = { state: "running" as const };
  it("gives each running step its own face", () => {
    expect(officeEmotion({ ...running })).toBe("thinking");
    expect(officeEmotion({ ...running, job: { step: "Read: a.ts" } })).toBe("searching");
    expect(officeEmotion({ ...running, job: { step: "Edit: a.ts" } })).toBe("writing");
    expect(officeEmotion({ ...running, job: { step: "npm test" } })).toBe("working");
  });

  it("shows a failed step, a fresh job and a stalled job before the step's own face", () => {
    expect(officeEmotion({ ...running, job: { step: "Edit: a.ts", stepOk: false } })).toBe("confused");
    expect(officeEmotion({ ...running, job: { step: "Edit: a.ts" }, sinceReceived: RECEIVE_MS - 1 })).toBe("receiving");
    expect(officeEmotion({ ...running, job: { step: "Edit: a.ts" }, sinceReceived: RECEIVE_MS })).toBe("writing");
    expect(officeEmotion({ ...running, job: { step: "Edit: a.ts" }, stepIdleMs: DROWSY_MS + 1 })).toBe("drowsy");
  });

  it("maps the other states", () => {
    expect(officeEmotion({ state: "queued" })).toBe("listening");
    expect(officeEmotion({ state: "waiting" })).toBe("alerting");
    expect(officeEmotion({ state: "out" })).toBe("sad");
  });

  it("lets an idle bot hand in its work, rest, then fall asleep", () => {
    expect(officeEmotion({ state: "idle" })).toBe("idle");
    expect(officeEmotion({ state: "idle", sinceFinished: SEND_MS - 1 })).toBe("sending");
    expect(officeEmotion({ state: "idle", sinceFinished: SEND_MS })).toBe("idle");
    expect(officeEmotion({ state: "idle", idleMs: SLEEP_MS + 1 })).toBe("sleeping");
  });

  it("makes a finished goal win over everything else", () => {
    expect(officeEmotion({ state: "out", celebrating: true })).toBe("celebrate");
    expect(CELEBRATE_MS).toBeGreaterThan(0);
  });
});
