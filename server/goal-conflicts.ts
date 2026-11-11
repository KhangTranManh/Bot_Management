import type { GoalConflict } from "../shared/group-goal-run.ts";
import type { GoalRunDeps, GoalRunMember } from "./group-goal-run.ts";
import type { LeadTaskPlan } from "./lead-schedule.ts";
import { pathDeclared, type WritesSnapshot } from "./writes-audit.ts";

const GOAL_WATCH_MS = 5_000;

export async function watchWaveConflicts<Bot extends GoalRunMember>(deps: GoalRunDeps<Bot>, wave: {
  workers: ReadonlyArray<{ plan: LeadTaskPlan; bot: Bot }>; before: WritesSnapshot; since: number; settled: Promise<unknown>; seen: Set<string>; lead: string;
}): Promise<GoalConflict[]> {
  if (!deps.laneEdits || !deps.writesOutside) return [];
  const found: GoalConflict[] = [];
  let done = false;
  void wave.settled.then(() => { done = true; }, () => { done = true; });
  const scan = async (live: boolean) => {
    const changed = (await deps.writesOutside!(wave.before, [])) ?? [];
    if (!changed.length) return;
    const edits = await Promise.all(wave.workers.map(async (entry) => ({ entry, paths: await deps.laneEdits!(entry.bot.id, wave.since) })));
    for (const file of changed) {
      const editors = edits.filter(({ paths }) => paths.some((path) => pathDeclared(path, [file]))).map(({ entry }) => entry);
      const owner = wave.workers.find(({ plan }) => plan.writes?.length && pathDeclared(file, plan.writes)) ?? editors[0];
      if (!owner) continue;
      for (const other of editors) {
        const key = `${file}|${other.plan.id}`;
        if (other === owner || wave.seen.has(key)) continue;
        wave.seen.add(key);
        const steered = live && deps.steerLane
          ? await deps.steerLane(other.bot.id, `Harness note: ${file} belongs to task ${owner.plan.id} (${owner.bot.name}) in this plan. Stop editing it, finish your own files, and tell ${wave.lead} in your reply what you needed changed there.`).catch(() => false)
          : false;
        const conflict: GoalConflict = {
          file, ownerTask: owner.plan.id, ownerBotId: owner.bot.id, ownerName: owner.bot.name,
          otherTask: other.plan.id, otherBotId: other.bot.id, otherName: other.bot.name, steered, at: Date.now(),
        };
        found.push(conflict);
        deps.recordConflict?.(conflict);
        deps.note(`Conflict: ${other.bot.name} (task ${other.plan.id}) edited ${file}, which belongs to ${owner.bot.name} (task ${owner.plan.id})${steered ? "; told to stop" : ""}`);
      }
    }
  };
  while (!done && !deps.cancelled()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([new Promise((resolve) => { timer = setTimeout(resolve, deps.watchMs ?? GOAL_WATCH_MS); }), wave.settled.catch(() => undefined)]);
    clearTimeout(timer);
    if (!done && !deps.cancelled()) await scan(true);
  }
  if (!deps.cancelled()) await scan(false);
  return found;
}

