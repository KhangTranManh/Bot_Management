import { describe, expect, it } from "vitest";
import { goalWavesEnabled } from "./lead-cap.ts";

describe("goalWavesEnabled", () => {
  it("is on for a room of three or more members, off below", () => {
    expect(goalWavesEnabled({ memberCount: 3 }, {})).toBe(true);
    expect(goalWavesEnabled({ memberCount: 6 }, {})).toBe(true);
    expect(goalWavesEnabled({ memberCount: 2 }, {})).toBe(false);
  });

  it("lets the room turn waves off, whatever the environment says", () => {
    expect(goalWavesEnabled({ memberCount: 5, goalWaves: false }, {})).toBe(false);
    expect(goalWavesEnabled({ memberCount: 5, goalWaves: false }, { OMB_LEAD_DEPT_CAP: "1" })).toBe(false);
  });

  it("follows OMB_LEAD_DEPT_CAP=0 off everywhere and =1 on for any room", () => {
    expect(goalWavesEnabled({ memberCount: 5 }, { OMB_LEAD_DEPT_CAP: "0" })).toBe(false);
    expect(goalWavesEnabled({ memberCount: 2 }, { OMB_LEAD_DEPT_CAP: "1" })).toBe(true);
  });
});
