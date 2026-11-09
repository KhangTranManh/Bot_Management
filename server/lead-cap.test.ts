import { describe, expect, it } from "vitest";
import { capLeadDeptLevel, isLeadDeptBot, leadDeptCapEnabled } from "./lead-cap.ts";

const leadBot = { installedPackage: { id: "lead-dept", name: "Lead department", release: "0.1.0", requiredApps: [] } };
const otherBot = { installedPackage: { id: "sales-desk", name: "Sales", release: "1.0.0", requiredApps: [] } };
const noPkg = {};

describe("leadDeptCapEnabled", () => {
  it("is off unless OMB_LEAD_DEPT_CAP=1", () => {
    expect(leadDeptCapEnabled({})).toBe(false);
    expect(leadDeptCapEnabled({ OMB_LEAD_DEPT_CAP: "1" })).toBe(true);
  });
});

describe("isLeadDeptBot", () => {
  it("matches only the lead-dept package id", () => {
    expect(isLeadDeptBot(leadBot)).toBe(true);
    expect(isLeadDeptBot(otherBot)).toBe(false);
    expect(isLeadDeptBot(noPkg)).toBe(false);
  });
});

describe("capLeadDeptLevel", () => {
  it("flag off: level unchanged for everyone", () => {
    expect(capLeadDeptLevel(leadBot, "full", {})).toBe("full");
    expect(capLeadDeptLevel(otherBot, "auto", {})).toBe("auto");
  });
  it("flag on: lead-dept bot is capped at edits", () => {
    const env = { OMB_LEAD_DEPT_CAP: "1" };
    expect(capLeadDeptLevel(leadBot, "full", env)).toBe("edits");
    expect(capLeadDeptLevel(leadBot, "auto", env)).toBe("edits");
    expect(capLeadDeptLevel(leadBot, "edits", env)).toBe("edits");
    expect(capLeadDeptLevel(leadBot, "ask", env)).toBe("ask");
  });
  it("flag on: other bots unchanged", () => {
    const env = { OMB_LEAD_DEPT_CAP: "1" };
    expect(capLeadDeptLevel(otherBot, "full", env)).toBe("full");
    expect(capLeadDeptLevel(noPkg, "auto", env)).toBe("auto");
  });
});
