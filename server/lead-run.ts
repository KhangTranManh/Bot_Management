import { leadGuard, type LeadGoal, type LeadLedgerEntry, type LeadTaskBallot } from "./lead-goal.ts";
import { checkLeadRoleVendors } from "./lead-roles.ts";
import { leadConflictsInWave, leadWaves } from "./lead-schedule.ts";

export type LeadRoundPlan =
  | { action: "stop"; reason: string }
  | { action: "approve-and-dispatch"; wave: LeadTaskBallot[]; serialize: Array<[string, string]>; round: number };

export interface LeadRunState {
  dispatched: readonly string[];
  verified: readonly string[];
}

/** One autonomy-level-1 round: guard, vendor rule, then the next wave of undispatched, verified-dependency tasks. */
export function planLeadRound(
  goal: LeadGoal,
  ballots: readonly LeadTaskBallot[],
  ledger: readonly LeadLedgerEntry[],
  state: LeadRunState,
  now: number,
  maxWorkers: number,
): LeadRoundPlan {
  const guard = leadGuard(goal, ledger, now);
  if (guard.action === "stop") return { action: "stop", reason: guard.reason };
  const vendors = checkLeadRoleVendors(ballots);
  if (!vendors.ok) return { action: "stop", reason: vendors.error };
  const goalBallots = ballots.filter((b) => b.goalId === goal.id);
  const waves = leadWaves(goalBallots, maxWorkers);
  if (!waves.ok) return { action: "stop", reason: waves.error };
  const wave = (waves.waves.find((w) => w.some((b) => !state.dispatched.includes(b.id))) ?? [])
    .filter((b) => !state.dispatched.includes(b.id) && b.dependsOn.every((d) => state.verified.includes(d)));
  if (wave.length === 0) return { action: "stop", reason: "no runnable task in the next wave" };
  return {
    action: "approve-and-dispatch",
    wave,
    serialize: leadConflictsInWave(wave),
    round: ledger.length + 1,
  };
}

export function makeLedgerEntry(round: number, at: number, over: Omit<LeadLedgerEntry, "at" | "round">): LeadLedgerEntry {
  return { at, round, ...over };
}

/** Serialize ledger entries as JSON lines; one line per round, Lead is the only writer. */
export function ledgerToJsonl(ledger: readonly LeadLedgerEntry[]): string {
  return ledger.map((e) => JSON.stringify(e)).join("\n") + (ledger.length ? "\n" : "");
}

export function parseLedgerJsonl(text: string): LeadLedgerEntry[] {
  const out: LeadLedgerEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const raw = JSON.parse(trimmed) as LeadLedgerEntry;
    out.push(raw);
  }
  return out;
}
