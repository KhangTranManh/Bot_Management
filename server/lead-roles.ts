import type { LeadRole, LeadTaskBallot } from "./lead-goal.ts";

/** Vendor per engine instance id; unknown instances count as their own vendor. */
export function leadVendorOf(instance: string, known: Record<string, string> = LEAD_DEFAULT_VENDORS): string {
  return known[instance.trim().toLowerCase()] ?? `instance:${instance.trim().toLowerCase()}`;
}

export const LEAD_DEFAULT_VENDORS: Record<string, string> = {
  claude: "anthropic",
  codex: "openai",
  openai: "openai",
  gpt: "openai",
  mistral: "mistral",
  grok: "xai",
  gemini: "google",
};

export type LeadRoleCheck = { ok: true } | { ok: false; error: string };

/** Hard rule: the implementer's vendor must differ from both the evaluator's and the reviewer's. */
export function checkLeadRoleVendors(
  ballots: readonly LeadTaskBallot[],
  vendors: Record<string, string> = LEAD_DEFAULT_VENDORS,
): LeadRoleCheck {
  const byRole = new Map<LeadRole, LeadTaskBallot[]>();
  for (const b of ballots) {
    const list = byRole.get(b.role) ?? [];
    list.push(b);
    byRole.set(b.role, list);
  }
  const impl = byRole.get("implementer") ?? [];
  const evals = byRole.get("evaluator") ?? [];
  const revs = byRole.get("reviewer") ?? [];
  for (const i of impl) {
    const iv = leadVendorOf(i.model.instance, vendors);
    for (const e of evals) {
      if (iv === leadVendorOf(e.model.instance, vendors)) {
        return { ok: false, error: `implementer ${i.id} and evaluator ${e.id} share vendor ${iv}` };
      }
    }
    for (const r of revs) {
      if (iv === leadVendorOf(r.model.instance, vendors)) {
        return { ok: false, error: `implementer ${i.id} and reviewer ${r.id} share vendor ${iv}` };
      }
    }
  }
  return { ok: true };
}
