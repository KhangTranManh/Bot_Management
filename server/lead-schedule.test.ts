import { describe, expect, it } from "vitest";
import { canRunParallel, leadConflictsInWave, leadTasksConflict, leadWaves, type LeadWaveResult } from "./lead-schedule.ts";
import type { LeadTaskBallot } from "./lead-goal.ts";

function ballot(id: string, over: Partial<LeadTaskBallot> = {}): LeadTaskBallot {
  return {
    version: 1,
    id,
    goalId: "g1",
    title: id,
    reads: [],
    writes: [],
    locks: [],
    doneWhen: "done",
    role: "implementer",
    model: { instance: "claude", model: "m" },
    dependsOn: [],
    ...over,
  };
}

describe("leadTasksConflict", () => {
  it("same id conflicts", () => {
    expect(leadTasksConflict(ballot("a"), ballot("a"))).toBe(true);
  });
  it("overlapping writes conflict", () => {
    expect(leadTasksConflict(ballot("a", { writes: ["x.ts"] }), ballot("b", { writes: ["x.ts"] }))).toBe(true);
  });
  it("write vs read conflicts both ways", () => {
    expect(leadTasksConflict(ballot("a", { writes: ["x.ts"] }), ballot("b", { reads: ["x.ts"] }))).toBe(true);
    expect(leadTasksConflict(ballot("a", { reads: ["x.ts"] }), ballot("b", { writes: ["x.ts"] }))).toBe(true);
  });
  it("shared lock conflicts", () => {
    expect(leadTasksConflict(ballot("a", { locks: ["gpu"] }), ballot("b", { locks: ["gpu"] }))).toBe(true);
  });
  it("disjoint tasks do not conflict", () => {
    expect(canRunParallel(ballot("a", { writes: ["a.ts"] }), ballot("b", { reads: ["b.ts"], writes: ["b.ts"] }))).toBe(true);
  });
});

describe("leadWaves", () => {
  it("orders by dependsOn", () => {
    const r = leadWaves([ballot("c", { dependsOn: ["b"] }), ballot("b", { dependsOn: ["a"] }), ballot("a")], 5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.waves.map((w) => w.map((t) => t.id))).toEqual([["a"], ["b"], ["c"]]);
  });
  it("parallel independent tasks share a wave up to the limit", () => {
    const r = leadWaves([ballot("a"), ballot("b"), ballot("c"), ballot("d"), ballot("e"), ballot("f"), ballot("g")], 5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.waves[0]!.length).toBe(5);
      expect(r.waves[1]!.map((t) => t.id)).toEqual(["f", "g"]);
    }
  });
  it("caps wave size at LEAD_MAX_WAVE_SIZE even with many workers", () => {
    const r = leadWaves(Array.from({ length: 12 }, (_, i) => ballot(`t${i}`)), 40);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.waves.every((w) => w.length <= 5)).toBe(true);
  });
  it("rejects unknown dependency", () => {
    const r = leadWaves([ballot("a", { dependsOn: ["ghost"] })], 5) as LeadWaveResult;
    expect(r.ok).toBe(false);
  });
  it("rejects cycles", () => {
    const r = leadWaves([ballot("a", { dependsOn: ["b"] }), ballot("b", { dependsOn: ["a"] })], 5);
    expect(r.ok).toBe(false);
  });
  it("rejects self-dependency", () => {
    expect(leadWaves([ballot("a", { dependsOn: ["a"] })], 5).ok).toBe(false);
  });
});

describe("leadConflictsInWave", () => {
  it("lists conflicting pairs", () => {
    const wave = [ballot("a", { writes: ["x"] }), ballot("b", { writes: ["x"] }), ballot("c")];
    expect(leadConflictsInWave(wave)).toEqual([["a", "b"]]);
  });
});
