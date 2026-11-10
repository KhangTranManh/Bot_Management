import { describe, expect, it } from "vitest";
import { roleCeilingEnabled } from "./role-ceiling.ts";

describe("roleCeilingEnabled", () => {
  it("is off unless explicitly enabled", () => {
    expect(roleCeilingEnabled({})).toBe(false);
    expect(roleCeilingEnabled({ OMB_ROLE_CEILING: "1" })).toBe(true);
    expect(roleCeilingEnabled({ OMB_ROLE_CEILING: "0" })).toBe(false);
    expect(roleCeilingEnabled({ OMB_ROLE_CEILING: "true" })).toBe(false);
  });
});
