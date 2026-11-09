import { z } from "zod";

export const LEAD_GOAL_VERSION = 1;

export const leadRoleSchema = z.enum(["lead", "implementer", "evaluator", "reviewer", "reporter"]);
export type LeadRole = z.output<typeof leadRoleSchema>;

export const leadModelSchema = z.object({
  instance: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
});

const pathList = z.array(z.string().trim().min(1).max(500)).max(200);

export const leadGoalSchema = z.object({
  version: z.literal(LEAD_GOAL_VERSION),
  id: z.string().trim().min(1).max(100),
  goal: z.string().trim().min(1).max(4000),
  metrics: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  constraints: pathList.optional().default([]),
  budget: z.object({
    hours: z.number().positive().max(24 * 365),
    maxRounds: z.number().int().positive().max(1000),
  }),
  stop: z.object({
    success: z.string().trim().min(1).max(2000),
    failNoImproveRounds: z.number().int().min(1).max(10).default(2),
  }),
  forbidden: pathList.optional().default([]),
  protectedSets: pathList.optional().default([]),
  sharedInputs: pathList.optional().default([]),
  pilotGate: z.string().trim().max(2000).optional(),
  autonomy: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  createdAt: z.number().int().positive(),
});
export type LeadGoal = z.output<typeof leadGoalSchema>;

export const leadTaskBallotSchema = z.object({
  version: z.literal(LEAD_GOAL_VERSION),
  id: z.string().trim().min(1).max(100),
  goalId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  reads: pathList.optional().default([]),
  writes: pathList.optional().default([]),
  locks: z.array(z.string().trim().min(1).max(200)).max(50).optional().default([]),
  doneWhen: z.string().trim().min(1).max(4000),
  role: leadRoleSchema,
  model: leadModelSchema,
  dependsOn: z.array(z.string().trim().min(1).max(100)).max(50).optional().default([]),
});
export type LeadTaskBallot = z.output<typeof leadTaskBallotSchema>;

export type LeadParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseLeadGoal(text: string): LeadParseResult<LeadGoal> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `goal is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = leadGoalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `goal: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  return { ok: true, value: parsed.data };
}

export function parseLeadTaskBallot(text: string): LeadParseResult<LeadTaskBallot> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `task ballot is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = leadTaskBallotSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `task ballot: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  return { ok: true, value: parsed.data };
}

export interface LeadLedgerEntry {
  at: number;
  round: number;
  hypothesis: string;
  config: string;
  result: string;
  decision: "continue" | "redirect" | "stop";
  improved: boolean;
}

export type LeadGuardDecision =
  | { action: "run" }
  | { action: "stop"; reason: "budget-hours" | "budget-rounds" | "no-improvement" };

export function leadGuard(goal: LeadGoal, ledger: readonly LeadLedgerEntry[], now: number): LeadGuardDecision {
  const start = goal.createdAt;
  if (now - start > goal.budget.hours * 3_600_000) return { action: "stop", reason: "budget-hours" };
  const rounds = ledger.length;
  if (rounds >= goal.budget.maxRounds) return { action: "stop", reason: "budget-rounds" };
  const recent = ledger.slice(-goal.stop.failNoImproveRounds);
  if (recent.length === goal.stop.failNoImproveRounds && recent.every((e) => !e.improved)) {
    return { action: "stop", reason: "no-improvement" };
  }
  return { action: "run" };
}
