// POST /api/groups/<room>/tasks/<thread>/goals/<card>/accept: the person confirms a goal that stopped for them.
import { ownerOrAdmin } from "../request-auth.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Store } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

const WAITING_ON_PERSON = new Set(["needs-input", "limit-reached", "paused"]);

export function createGoalAcceptRoutes(deps: {
  store: Pick<Store, "group" | "groupTaskByThread" | "messagesFor" | "patchMessage">;
  working(groupId: string, threadId: string): boolean;
  threadRefusal(auth: RequestAuth, threadId: string): string | null;
  confirmedText(threadId: string): string;
  now?(): number;
}): RouteHandler {
  return async ({ path, method, auth, json, res }) => {
    const match = /^\/api\/groups\/([\w-]+)\/tasks\/([\w-]+)\/goals\/([\w-]+)\/accept$/.exec(path);
    if (!match || method !== "POST") return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only the owner or an admin can confirm a goal" });
    const [, groupId, threadId, cardId] = match;
    if (!deps.store.group(groupId!) || !deps.store.groupTaskByThread(groupId!, threadId!)) return json(res, 404, { error: "No such room conversation" });
    const refusal = deps.threadRefusal(auth, threadId!);
    if (refusal) return json(res, 403, { error: refusal });
    const message = deps.store.messagesFor(threadId!).find((candidate) => candidate.id === cardId);
    const goalRun = message?.goalRun;
    if (!message || !goalRun) return json(res, 404, { error: "No goal on this card" });
    if (goalRun.status === "completed") return json(res, 200, { goalRun });
    if (deps.working(groupId!, threadId!)) return json(res, 409, { error: "Stop the goal before confirming it" });
    if (!WAITING_ON_PERSON.has(goalRun.status)) return json(res, 409, { error: `A goal that is ${goalRun.status} is not waiting for you` });
    const confirmed = { ...goalRun, status: "completed" as const, finishedAt: (deps.now ?? Date.now)() };
    deps.store.patchMessage(threadId!, message.id, { text: deps.confirmedText(threadId!), goalRun: confirmed });
    return json(res, 200, { goalRun: confirmed });
  };
}
