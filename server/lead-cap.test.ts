import { describe, expect, it } from "vitest";
import { leadDeptCapEnabled } from "./lead-cap.ts";

describe("leadDeptCapEnabled", () => {
  it("is off unless explicitly enabled", () => {
    expect(leadDeptCapEnabled({})).toBe(false);
    expect(leadDeptCapEnabled({ OMB_LEAD_DEPT_CAP: "1" })).toBe(true);
    expect(leadDeptCapEnabled({ OMB_LEAD_DEPT_CAP: "0" })).toBe(false);
    expect(leadDeptCapEnabled({ OMB_LEAD_DEPT_CAP: "true" })).toBe(false);
  });
});
