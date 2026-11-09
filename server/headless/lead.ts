import { EXIT, flag, parseCount, usageError } from "./args.ts";
import type { VerbContext, VerbOutcome } from "./context.ts";
import { leadRunnerEnabled, readLeadLedger, readLeadWorkspace } from "../lead-runner.ts";
import { planLeadRound } from "../lead-run.ts";
import { checkLeadRoleVendors } from "../lead-roles.ts";
import { LEAD_MAX_WAVE_SIZE, leadConflictsInWave, leadWaves } from "../lead-schedule.ts";

export async function leadPlanVerb(ctx: VerbContext): Promise<VerbOutcome> {
  const dir = ctx.positionals[0]?.trim();
  if (!dir) throw usageError("a workspace directory is required", "openmausbot lead plan DIR");
  const workers = parseCount(flag(ctx.flags, "workers"), "--workers", LEAD_MAX_WAVE_SIZE, LEAD_MAX_WAVE_SIZE);
  if (!leadRunnerEnabled(ctx.env)) {
    return { result: { disabled: true }, exitCode: EXIT.failed, human: ["The lead dept feature is off: set OMB_LEAD_DEPT_CAP=1 and run again."] };
  }
  const loaded = await readLeadWorkspace(dir);
  if (!loaded.ok) return { result: { error: loaded.error }, exitCode: EXIT.failed, human: [loaded.error] };
  const { goal, ballots } = loaded.workspace;
  const vendors = checkLeadRoleVendors(ballots);
  if (!vendors.ok) return { result: { error: vendors.error }, exitCode: EXIT.failed, human: [vendors.error] };
  const waves = leadWaves(ballots, workers);
  if (!waves.ok) return { result: { error: waves.error }, exitCode: EXIT.failed, human: [waves.error] };
  const conflicts = waves.waves
    .map((wave, index) => ({ wave: index + 1, pairs: leadConflictsInWave(wave) }))
    .filter((entry) => entry.pairs.length > 0);
  const ledger = await readLeadLedger(dir);
  const next = planLeadRound(goal, ballots, ledger, { dispatched: [], verified: [] }, Date.now(), workers);
  const result = {
    goal: { id: goal.id, goal: goal.goal, autonomy: goal.autonomy, budget: goal.budget, stop: goal.stop },
    taskCount: ballots.length,
    waves: waves.waves.map((wave) => wave.map((task) => task.id)),
    conflicts,
    next,
  };
  const human = [
    `goal ${goal.id} · autonomy ${goal.autonomy} · budget ${goal.budget.hours}h, ${goal.budget.maxRounds} rounds · ${ballots.length} tasks`,
    ...waves.waves.map((wave, index) => `wave ${index + 1}: ${wave.map((task) => task.id).join(", ")}`),
    ...conflicts.map((entry) => `wave ${entry.wave} serialize: ${entry.pairs.map((pair) => pair.join(" then ")).join("; ")}`),
    next.action === "approve-and-dispatch"
      ? `next (round ${next.round}): dispatch ${next.wave.map((task) => task.id).join(", ")}${next.serialize.length ? `; serialize ${next.serialize.map((pair) => pair.join(" then ")).join("; ")}` : ""}`
      : `next: stop (${next.reason})`,
  ];
  return { result, exitCode: EXIT.done, human };
}
