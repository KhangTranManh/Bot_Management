import { describe, expect, it } from "vitest";
import type { WireMessage } from "../shared/wire.ts";
import { changedPlanBrief, checkedRoomPlan, goalPlanContext, latestRoomPlan, parseRoomPlanReply, roomPlanInstructions, roomPlanText } from "./room-plan.ts";

const brief = {
  goal: "Ship a notes app", inScope: ["notes"], outOfScope: [], acceptance: ["A note can be listed"], constraints: [], openQuestions: [],
  structure: [{ name: "backend", paths: ["server/"], owns: "API" }, { name: "frontend", paths: ["web/"], owns: "screens" }],
};
const waves = [{ name: "Foundation", areas: ["backend"], deliverable: "API" }, { name: "Screens", areas: ["frontend"], deliverable: "List screen" }];
const envelope = (value: unknown) => `Summary.\n<openmaus-goal>${JSON.stringify(value)}</openmaus-goal>`;

describe("a room outline", () => {
  it("keeps brief and ordered waves", () => {
    const draft = checkedRoomPlan({ brief, waves });
    expect(draft.waves.map((wave) => wave.name)).toEqual(["Foundation", "Screens"]);
    expect(draft.brief.structure?.map((area) => area.name)).toEqual(["backend", "frontend"]);
  });

  it.each([
    ["a task field", { brief, waves, tasks: [] }, "unknown field"],
    ["a task inside a wave", { brief, waves: [{ ...waves[0], assignee: "x" }] }, "unknown field"],
    ["no waves", { brief, waves: [] }, "1 to 8 ordered waves"],
    ["a repeated wave", { brief, waves: [waves[0], waves[0]] }, "repeats wave"],
    ["an unknown area", { brief, waves: [{ ...waves[0], areas: ["db"] }] }, "areas from the structure"],
    ["no acceptance checks", { brief: { ...brief, acceptance: [] }, waves }, "acceptance"],
    ["no structure", { brief: { ...brief, structure: undefined }, waves }, "plan"],
  ])("refuses %s", (_name, raw, problem) => {
    expect(() => checkedRoomPlan(raw)).toThrow(problem);
  });

  it("reads the last private envelope of a reply, or says what is missing", () => {
    expect(parseRoomPlanReply(envelope({ brief, waves }))).toMatchObject({ draft: { waves: [{ name: "Foundation" }, { name: "Screens" }] } });
    expect(parseRoomPlanReply("No envelope")).toEqual({ problem: "Return a complete private plan envelope" });
    expect(parseRoomPlanReply(envelope({ brief, waves, tasks: [] }))).toMatchObject({ problem: expect.stringContaining("do not assign tasks") });
  });

  it("prefers the newest ready card of the thread over the saved profile", () => {
    const draft = checkedRoomPlan({ brief, waves });
    const older = checkedRoomPlan({ brief: { ...brief, goal: "Old" }, waves });
    const card = (id: string, status: "ready" | "failed" | "working", value = draft) => ({ id, kind: "room.plan", roomPlan: { id, status, draft: value } }) as unknown as WireMessage;
    expect(latestRoomPlan([card("a", "ready", older), card("b", "ready"), card("c", "failed"), card("d", "working")])).toMatchObject({ source: "conversation", cardId: "b", draft: { brief: { goal: "Ship a notes app" } } });
    expect(latestRoomPlan([card("c", "failed")], { plan: older })).toMatchObject({ source: "profile", draft: { brief: { goal: "Old" } } });
    expect(latestRoomPlan([])).toBeUndefined();
  });

  it("tells the Lead to keep the brief or give a reason", () => {
    const draft = checkedRoomPlan({ brief, waves });
    expect(roomPlanText(draft)).toContain("1. Foundation [backend]: API");
    expect(goalPlanContext({ source: "profile", draft })).toContain("planChangeReason");
    expect(changedPlanBrief(draft.brief, draft.brief)).toBe(false);
    expect(changedPlanBrief(draft.brief, { ...draft.brief, goal: "Other" })).toBe(true);
  });

  it("asks for an outline without tasks and repeats a refusal", () => {
    const text = roomPlanInstructions({ request: "a notes app", roster: "Lead (l)", problem: "plan needs 1 to 8 ordered waves" });
    expect(text).toContain("Do not start work, edit files or assign tasks.");
    expect(text).toContain("Your previous outline was refused: plan needs 1 to 8 ordered waves");
    expect(roomPlanInstructions({ request: "", roster: "Lead (l)" })).toContain("Outline the work discussed in this conversation.");
  });
});

describe("the /plan command", () => {
  it("reads the request after /plan", async () => {
    const { planTextFromMessage } = await import("../shared/room-plan.ts");
    expect(planTextFromMessage("/plan a notes app")).toBe("a notes app");
    expect(planTextFromMessage("  /PLAN")).toBe("");
    expect(planTextFromMessage("/planning")).toBeNull();
    expect(planTextFromMessage("please /plan")).toBeNull();
  });
});
