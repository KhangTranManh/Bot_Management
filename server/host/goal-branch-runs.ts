import { realpath } from "node:fs/promises";
import type { GoalBranchCard } from "../../shared/goal-branches.ts";
import type { GroupRecord, Store } from "../store.ts";
import { createGoalBranches, GoalBranches, isGoalGitRepo } from "../goal-branches.ts";
import { GoalBranchWorkflowError } from "../goal-branch-workflow.ts";

export function createGoalBranchRuns(deps: {
  dataDir: string;
  store: Pick<Store, "group" | "groupTasks" | "messagesFor" | "patchMessage">;
  release?(groupId: string, threadId: string): Promise<void>;
}) {
  const managers = new Map<string, GoalBranches>();
  const decisions = new Map<string, Promise<unknown>>();
  const key = (groupId: string, runId: string) => `${groupId}:${runId}`;
  const load = async (groupId: string, runId: string, repo: string, reopen: boolean) => {
    const known = managers.get(key(groupId, runId));
    if (known && await realpath(repo) !== known.state().repo) throw new Error("The room no longer points to this goal's original repository");
    if (known && (!reopen || !known.state().released)) return known;
    const manager = await GoalBranches.restore({ groupId, runId, repo, dataDir: deps.dataDir }, reopen);
    managers.set(key(groupId, runId), manager);
    return manager;
  };
  return {
    async prepare(room: GroupRecord, threadId: string, runId: string, goal: string, folder: string | null): Promise<{ manager?: GoalBranches; notice?: string; created?: boolean }> {
      if (!room.isolatedBranches || room.dm) return {};
      await Promise.all([...decisions.entries()].filter(([id]) => id.startsWith(`${room.id}:`)).map(([, pending]) => pending.catch(() => undefined)));
      if (room.kind === "research") throw new GoalBranchWorkflowError("Isolated branches are not enabled for research rooms.");
      if (!folder || !await isGoalGitRepo(folder)) return { notice: "Isolated branches are unavailable without a Git working folder; this goal uses the room's shared folder." };
      if (room.goalWaves === false) throw new GoalBranchWorkflowError("Enable parallel goal work before using isolated branches.", "needs-input");
      const roles = room.roles ? Object.fromEntries(Object.entries(room.roles).filter(([id]) => room.memberIds.includes(id))) : undefined;
      if (!roles || !["lead", "worker", "tester", "reviewer"].every((role) => Object.values(roles).includes(role as "lead" | "worker" | "tester" | "reviewer"))) throw new GoalBranchWorkflowError("Isolated branches need a Lead, Worker, Tester and Reviewer in Team status.", "needs-input");
      const prior = [...deps.store.messagesFor(threadId)].reverse().find((message) => message.goalRun?.goal === goal && message.goalRun.branches?.decision === "pending" && !["completed", "working"].includes(message.goalRun.status))?.goalRun?.branches;
      const manager = prior ? await load(room.id, prior.runId, folder, true) : await createGoalBranches({ groupId: room.id, runId, repo: folder, dataDir: deps.dataDir });
      managers.set(key(room.id, manager.state().runId), manager);
      return { manager, created: !prior, ...(prior ? { notice: `Continuing retained integration branch ${manager.state().branch}; its existing merged files are the starting point. Unfinished Worker branches are kept separately.` } : {}) };
    },
    decide(groupId: string, threadId: string, cardId: string, action: "merge" | "keep" | "discard", head: string): Promise<GoalBranchCard> {
      const room = deps.store.group(groupId);
      const card = deps.store.messagesFor(threadId).find((message) => message.id === cardId)?.goalRun;
      if (!room || !card?.branches) return Promise.reject(new Error("No retained branch on this goal card"));
      if (card.status === "working" || (action === "merge" && card.status !== "completed")) return Promise.reject(new Error("Only a completed goal may merge; stop a running goal before keeping or discarding it"));
      if (card.branches.head !== head) return Promise.reject(new Error("Goal card changed; reload it before deciding"));
      const id = key(groupId, card.branches.runId);
      const pending = (decisions.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        const folder = room.cwd ?? room.pinnedCwd;
        if (!folder) throw new Error("The room no longer has its original working folder");
        await deps.release?.(groupId, threadId);
        const manager = await load(groupId, card.branches!.runId, folder, action === "merge" && card.branches!.decision !== "merged" && card.branches!.decision !== "discarded");
        const value = await manager.decide(action, head);
        for (const task of deps.store.groupTasks(groupId)) {
          for (const message of deps.store.messagesFor(task.threadId)) {
            if (message.goalRun?.branches?.runId === value.runId) deps.store.patchMessage(task.threadId, message.id, { goalRun: { ...message.goalRun, branches: value } });
          }
        }
        return value;
      });
      decisions.set(id, pending);
      return pending.finally(() => { if (decisions.get(id) === pending) decisions.delete(id); });
    },
  };
}
