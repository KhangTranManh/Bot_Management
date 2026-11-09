import { describe, expect, it } from "vitest";
import { checkLeadRoleVendors, leadVendorOf } from "./lead-roles.ts";
import type { LeadTaskBallot } from "./lead-goal.ts";

function ballot(id: string, role: LeadTaskBallot["role"], instance: string): LeadTaskBallot {
  return {
    version: 1, id, goalId: "g", title: id, reads: [], writes: [], locks: [],
    doneWhen: "done", role, model: { instance, model: "m" }, dependsOn: [],
  };
}

describe("leadVendorOf", () => {
  it("maps known instances and falls back to instance name", () => {
    expect(leadVendorOf("claude")).toBe("anthropic");
    expect(leadVendorOf("Mistral")).toBe("mistral");
    expect(leadVendorOf("my-custom")).toBe("instance:my-custom");
  });
});

describe("checkLeadRoleVendors", () => {
  it("accepts implementer on a different vendor than evaluator and reviewer", () => {
    const r = checkLeadRoleVendors([
      ballot("i", "implementer", "claude"),
      ballot("e", "evaluator", "mistral"),
      ballot("r", "reviewer", "codex"),
    ]);
    expect(r).toEqual({ ok: true });
  });
  it("rejects implementer sharing vendor with evaluator", () => {
    const r = checkLeadRoleVendors([ballot("i", "implementer", "claude"), ballot("e", "evaluator", "claude")]);
    expect(r.ok).toBe(false);
  });
  it("rejects implementer sharing vendor with reviewer", () => {
    const r = checkLeadRoleVendors([ballot("i", "implementer", "codex"), ballot("v", "reviewer", "openai")]);
    expect(r.ok).toBe(false);
  });
  it("accepts when no implementer is present", () => {
    expect(checkLeadRoleVendors([ballot("e", "evaluator", "claude")]).ok).toBe(true);
  });
});
