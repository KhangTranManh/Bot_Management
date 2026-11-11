import type { GoalBranchCard } from "../shared/goal-branches.ts";
import type { TeamRole } from "../shared/team-roles.ts";
import type { LeadTaskPlan } from "./lead-schedule.ts";
import { groupGoalWorkerInstructions, type GoalRunMember, type GoalStepResult } from "./group-goal-run.ts";
import { teamRoleRule } from "./team-roles.ts";
import { branchPaths, type GoalBranches, type GoalBranchTask } from "./goal-branches.ts";
import { writesOutside, writesSnapshot } from "./writes-audit.ts";

export interface GoalBranchAssignment<Bot extends GoalRunMember> {
  bot: Bot;
  plan: LeadTaskPlan;
  role?: string;
  assignment: string;
  readOnly?: boolean;
  cwd?: string;
}

export interface GoalBranchDispatch<Bot extends GoalRunMember> {
  dispatch(batch: GoalBranchAssignment<Bot>[]): Promise<Array<GoalStepResult & { botId: string }>>;
  hasChanges(): boolean;
  ownerOf(file?: string, taskId?: string): { id: string; name: string } | undefined;
  pendingProblem(): Promise<string | undefined>;
  planProblem(entries: Array<{ bot: Bot; plan: LeadTaskPlan }>): string | undefined;
}

export class GoalBranchWorkflowError extends Error {
  readonly status: "blocked" | "needs-input";
  constructor(message: string, status: "blocked" | "needs-input" = "blocked") { super(message); this.status = status; }
}

export function createGoalBranchWorkflow<Bot extends GoalRunMember>(deps: {
  manager: GoalBranches;
  run: { goal: string; turnCount: number; maxTurns: number };
  lead: Bot;
  roleOf(botId: string): TeamRole | undefined;
  botOf(botId: string): Bot | undefined;
  cancelled(): boolean;
  prepare(cwd: string): Promise<void>;
  execute(batch: GoalBranchAssignment<Bot>[]): Promise<Array<GoalStepResult & { botId: string }>>;
  note(text: string): void;
  update(card: GoalBranchCard): void;
}): GoalBranchDispatch<Bot> {
  const { manager, run } = deps;
  const update = () => deps.update(manager.card());
  const repair = async (task: GoalBranchTask) => {
    const bot = deps.botOf(task.botId);
    if (!bot || bot.hidden || deps.roleOf(bot.id) !== "worker") throw new GoalBranchWorkflowError(`The owner of conflict task ${task.taskId} is unavailable. Its branch was kept.`, "needs-input");
    const patch = await manager.diffFile(task.key);
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (deps.cancelled()) return;
      if (run.turnCount + 1 >= run.maxTurns) throw new GoalBranchWorkflowError("The goal reached its turn limit before the merge conflict could be repaired. Continue this goal to keep working on its retained branch.", "needs-input");
      const next = await manager.openTask({ taskId: `${task.taskId}-merge-${attempt}`, botId: bot.id, writes: [...new Set([...task.writes, ...task.conflicts])] });
      await deps.prepare(next.cwd);
      if (deps.cancelled()) return;
      const assignment = groupGoalWorkerInstructions({ goal: run.goal, coordinatorName: deps.lead.name, role: "Worker", assignment: `Resolve the merge conflict for task ${task.taskId}. Your original changes are in ${patch}. Read that patch and the integrated files, then combine both Workers' intended changes without dropping either. Conflicted files: ${task.conflicts.join(", ")}. Change only: ${next.writes.join(", ")}.`, turn: run.turnCount + 2, maxTurns: run.maxTurns, teamRule: teamRoleRule("worker") });
      deps.note(`Merge conflict: ${bot.name} repairs task ${task.taskId} (${attempt}/2): ${task.conflicts.join(", ")}`);
      update();
      const [result] = await deps.execute([{ bot, plan: { id: next.taskId, assignee: bot.id, instruction: assignment, writes: next.writes }, role: "Worker", assignment, cwd: next.cwd }]);
      if (result?.ran) run.turnCount += 1;
      if (deps.cancelled()) return;
      if (!result?.ran || result.outcome !== "settled") continue;
      const committed = await manager.commitTask(next.key);
      if (!task.conflicts.every((file) => committed.changed.includes(file))) { manager.supersede(next.key); deps.note(`${bot.name}'s conflict repair did not change every conflicted file.`); continue; }
      const [merged] = await manager.mergeTasks([next.key]);
      if (merged?.status !== "conflict") {
        manager.supersede(task.key);
        deps.note(`${bot.name} repaired and merged task ${task.taskId}.`);
        update();
        return;
      }
    }
    throw new GoalBranchWorkflowError(`Merge conflict in task ${task.taskId} remained after two repair attempts. Branches and unfinished files have been kept.`, "needs-input");
  };
  const integrate = async (keys: readonly string[]) => {
    for (const key of keys) {
      if (deps.cancelled()) return;
      const [result] = await manager.mergeTasks([key]);
      update();
      if (result?.status === "conflict") await repair(manager.state().tasks.find((task) => task.key === key)!);
    }
  };
  return {
    planProblem(entries) {
      for (const { bot, plan } of entries) {
        if (deps.roleOf(bot.id) !== "worker") continue;
        try { branchPaths(plan.writes ?? []); } catch { return `task ${plan.id} must declare relative writes inside the repository; absolute paths, .. and .git are refused`; }
      }
      return undefined;
    },
    hasChanges: () => manager.state().head !== manager.state().originalHead,
    ownerOf(file, taskId) {
      const tasks = manager.state().tasks.filter((task) => task.phase === "merged").reverse();
      const task = tasks.find((task) => taskId !== undefined && task.taskId === taskId) ?? tasks.find((task) => file !== undefined && task.changed.includes(file.replace(/\\/g, "/").replace(/^\.\//, "")));
      return task ? { id: task.taskId, name: deps.botOf(task.botId)?.name ?? task.botId } : undefined;
    },
    async pendingProblem() {
      if (manager.state().tasks.some((task) => task.phase === "conflict" || task.phase === "committed")) return "This goal still has unmerged Worker changes. Plan a Worker task so the retained changes can be integrated and checked.";
      try { await manager.checkIntegration(); } catch { return "The integrated working folder has uncommitted changes or its HEAD changed outside the goal. Inspect the retained branch before continuing."; }
      return undefined;
    },
    async dispatch(batch) {
      let batchRan = false;
      try {
        await integrate(manager.state().tasks.filter((task) => task.phase === "committed" || task.phase === "conflict").map((task) => task.key));
        const tasks = new Map<string, GoalBranchTask>();
        const prepared: GoalBranchAssignment<Bot>[] = [];
        for (const entry of batch) {
          if (deps.cancelled()) return [];
          if (deps.roleOf(entry.bot.id) === "worker") {
            const task = await manager.openTask({ taskId: entry.plan.id, botId: entry.bot.id, writes: entry.plan.writes ?? [] });
            tasks.set(entry.plan.id, task);
            await deps.prepare(task.cwd);
            prepared.push({ ...entry, cwd: task.cwd, assignment: `${entry.assignment}\nWork only inside your isolated working folder: ${task.cwd}. The other Workers have separate branches. The server commits and merges your files; do not switch branches or merge yourself.` });
          } else {
            const diffs: string[] = [];
            if (deps.roleOf(entry.bot.id) === "reviewer") {
              for (const task of manager.state().tasks.filter((task) => task.head && task.phase === "merged").slice(-16)) diffs.push(`- ${task.taskId} (${deps.botOf(task.botId)?.name ?? task.botId}): ${await manager.diffFile(task.key)}`);
            }
            prepared.push({ ...entry, cwd: manager.state().cwd, assignment: `${entry.assignment}\nCheck the integrated working folder: ${manager.state().cwd}.${diffs.length ? `\nRead the server-produced diffs for each task:\n${diffs.join("\n")}` : ""}` });
          }
        }
        if (deps.cancelled()) return [];
        const checkBefore = batch.some((entry) => deps.roleOf(entry.bot.id) !== "worker") ? await writesSnapshot(manager.state().cwd) : undefined;
        update();
        const results = await deps.execute(prepared);
        batchRan = results.some((result) => result.ran);
        if (deps.cancelled()) return results;
        if (checkBefore) {
          const after = await writesSnapshot(manager.state().cwd);
          const changed = after ? writesOutside(checkBefore, after, []) : [];
          if (changed.length) throw new GoalBranchWorkflowError(`Tester or Reviewer changed integrated files (${changed.slice(0, 8).join(", ")}); its check does not count. The files have been kept for inspection.`, "needs-input");
        }
        const committed: string[] = [];
        for (const entry of batch) {
          const task = tasks.get(entry.plan.id);
          const result = results.find((result) => result.botId === entry.bot.id);
          if (!task || !result?.ran || result.outcome !== "settled") continue;
          const saved = await manager.commitTask(task.key);
          if (saved.outsideWrites.length) deps.note(`${entry.bot.name} (task ${task.taskId}) changed files outside its declared writes: ${saved.outsideWrites.join(", ")}`);
          if (saved.phase === "empty") deps.note(`${entry.bot.name} (task ${task.taskId}) produced no file changes.`);
          committed.push(task.key);
        }
        await integrate(committed);
        return results;
      } catch (error) {
        if (batchRan) run.turnCount += 1;
        throw error;
      } finally { update(); }
    },
  };
}
