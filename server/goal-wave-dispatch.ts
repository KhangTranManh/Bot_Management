import { groupGoalWorkerInstructions, type GoalRunDeps, type GoalRunMember, type GoalStepOutcome, type GoalStepResult } from "./group-goal-run.ts";
import type { LeadTaskPlan } from "./lead-schedule.ts";
import { teamRoleRule } from "./team-roles.ts";

export async function dispatchWaveBatch<Bot extends GoalRunMember>(
  deps: GoalRunDeps<Bot>,
  entries: Array<{ plan: LeadTaskPlan; bot: Bot }>,
  project?: string,
): Promise<Array<{ entry: { plan: LeadTaskPlan; bot: Bot }; result: GoalStepResult }>> {
  const batch = entries.map((entry) => ({
    bot: entry.bot, role: entry.plan.role, assignment: groupGoalWorkerInstructions({ goal: deps.run.goal, coordinatorName: deps.coordinator.name, role: entry.plan.role, assignment: entry.plan.instruction, turn: deps.run.turnCount + 1, maxTurns: deps.run.maxTurns, teamRule: teamRoleRule(deps.roles?.[entry.bot.id]), projectContext: project }), ...(deps.roles?.[entry.bot.id] === "reviewer" ? { readOnly: true } : {}),
    plan: entry.plan,
  }));
  const dispatched = deps.branchWork ? await deps.branchWork.dispatch(batch) : await deps.dispatchWave!(batch);
  const normalize = (item: { ran: boolean; replyText: string; outcome?: GoalStepOutcome }) => ({
    ...item,
    outcome: item.outcome ?? (item.ran && item.replyText.trim() ? "settled" as const : "dispatch_failed" as const),
  });
  return entries.map((entry) => ({
    entry,
    result: dispatched.find((item) => item.botId === entry.bot.id) ?? { botId: entry.bot.id, ran: false, replyText: "", outcome: "dispatch_failed" as const },
  })).map(({ entry, result }) => ({ entry, result: normalize(result) }));
}

