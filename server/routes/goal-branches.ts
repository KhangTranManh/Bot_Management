import { z } from "zod";
import { ownerOrAdmin } from "../request-auth.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Store } from "../store.ts";
import type { GoalBranchCard } from "../../shared/goal-branches.ts";
import { PASS, type RouteHandler } from "./table.ts";

const decisionSchema = z.object({ action: z.enum(["merge", "keep", "discard"]), head: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/), confirm: z.literal(true).optional() }).strict();

export function createGoalBranchRoutes(deps: {
  store: Pick<Store, "group" | "groupTaskByThread" | "messagesFor">;
  working(groupId: string, threadId: string): boolean;
  threadRefusal(auth: RequestAuth, threadId: string): string | null;
  decide(groupId: string, threadId: string, cardId: string, action: "merge" | "keep" | "discard", head: string): Promise<GoalBranchCard>;
}): RouteHandler {
  return async ({ path, method, req, res, auth, readBody, json }) => {
    const match = /^\/api\/groups\/([\w-]+)\/tasks\/([\w-]+)\/goals\/([\w-]+)\/branches$/.exec(path);
    if (!match || method !== "POST") return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only the owner or an admin can decide goal branches" });
    const [, groupId, threadId, cardId] = match;
    if (!deps.store.group(groupId!) || !deps.store.groupTaskByThread(groupId!, threadId!)) return json(res, 404, { error: "No such room conversation" });
    const refusal = deps.threadRefusal(auth, threadId!);
    if (refusal) return json(res, 403, { error: refusal });
    if (deps.working(groupId!, threadId!)) return json(res, 409, { error: "Stop the goal before deciding its branches" });
    const card = deps.store.messagesFor(threadId!).find((message) => message.id === cardId)?.goalRun;
    if (!card?.branches) return json(res, 404, { error: "No branch on this goal card" });
    const parsed = decisionSchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "Provide an action, exact branch head and explicit confirmation for merge or discard" });
    if (parsed.data.action !== "keep" && parsed.data.confirm !== true) return json(res, 400, { error: "Confirm this merge or discard explicitly" });
    try {
      const branches = await deps.decide(groupId!, threadId!, cardId!, parsed.data.action, parsed.data.head);
      return json(res, 200, { branches });
    } catch (error) { return json(res, 409, { error: error instanceof Error ? error.message : "Cannot decide this branch" }); }
  };
}
