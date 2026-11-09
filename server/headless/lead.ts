import { resolve } from "node:path";
import { EXIT, flag, parseCount, usageError } from "./args.ts";
import { conversationFor, newSendId, resolveTarget, type VerbContext, type VerbOutcome } from "./context.ts";
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

export async function leadRunVerb(ctx: VerbContext): Promise<VerbOutcome> {
  const dir = ctx.positionals[0]?.trim();
  if (!dir) throw usageError("a workspace directory is required", "openmausbot lead run DIR");
  if (!leadRunnerEnabled(ctx.env)) {
    return { result: { disabled: true }, exitCode: EXIT.failed, human: ["The lead dept feature is off: set OMB_LEAD_DEPT_CAP=1 and run again."] };
  }
  const loaded = await readLeadWorkspace(dir);
  if (!loaded.ok) return { result: { error: loaded.error }, exitCode: EXIT.failed, human: [loaded.error] };
  const { goal, ballots } = loaded.workspace;
  const vendors = checkLeadRoleVendors(ballots);
  if (!vendors.ok) return { result: { error: vendors.error }, exitCode: EXIT.failed, human: [vendors.error] };
  const workers = parseCount(flag(ctx.flags, "workers"), "--workers", LEAD_MAX_WAVE_SIZE, LEAD_MAX_WAVE_SIZE);
  const waves = leadWaves(ballots, workers);
  if (!waves.ok) return { result: { error: waves.error }, exitCode: EXIT.failed, human: [waves.error] };
  const target = await resolveTarget(ctx, undefined, "bot");
  const abs = resolve(dir);
  const brief = [
    "New lead-dept job. You are the Lead.",
    "",
    `Goal: ${abs}/goal.json (id ${goal.id}, autonomy ${goal.autonomy}, budget ${goal.budget.hours}h / ${goal.budget.maxRounds} rounds).`,
    `Task ballots: ${abs}/tasks/*.json.`,
    "",
    "Deterministic plan:",
    ...waves.waves.map((wave, index) => `  wave ${index + 1}: ${wave.map((task) => task.id).join(", ")}`),
    "",
    "Run the lead-loop playbook: dispatch wave 1 with coordinate_bots (at most 4 teammates per call), then end your turn — results resume you. On return, have the Evaluator (a different vendor than each Implementer) verify doneWhen, and the Reviewer review. Append one JSON line to the ledger for the round: at, round, hypothesis, config, result, decision (continue|redirect|stop), improved. Then dispatch the next wave, or stop (budget exhausted, or two rounds in a row with no improvement).",
    "",
    goal.autonomy === 1 ? "Autonomy level 1: dispatch nothing until the person approves this plan." : `Autonomy level ${goal.autonomy}.`,
  ].join("\n");
  const client = await ctx.client();
  const taskId = await conversationFor(client, target, "new", `Goal ${goal.id}`);
  const sendId = newSendId();
  const sent = await client.tool("send_bot_message", { bot_id: target.id, task_id: taskId, text: brief, send_id: sendId });
  const threadId = (sent as { taskId?: string }).taskId ?? taskId;
  const result = {
    ok: true,
    threadId,
    sendId,
    goal: { id: goal.id, goal: goal.goal, autonomy: goal.autonomy },
    waves: waves.waves.map((wave) => wave.map((task) => task.id)),
    ...sent,
  };
  const human = [
    `Asked ${target.name ?? target.id} to run goal ${goal.id} (thread ${threadId}).`,
    `waves: ${waves.waves.map((wave, index) => `${index + 1}:[${wave.map((task) => task.id).join(", ")}]`).join(" → ")}`,
    `Wait for it: openmausbot wait --thread ${threadId}`,
  ];
  return { result, exitCode: EXIT.done, human };
}
