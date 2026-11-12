import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../request-auth.ts";
import type { RouteContext } from "./table.ts";
import { createGoalAcceptRoutes } from "./goal-accept.ts";

const OWNER: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

async function request(options: { auth?: RequestAuth; status?: string; working?: boolean; refusal?: string; thread?: string; card?: string; method?: string } = {}) {
  let result: { status: number; body: unknown } | undefined;
  const patchMessage = vi.fn();
  const messages = [{ id: "card", goalRun: { runId: "run", status: options.status ?? "needs-input" } }, { id: "plain" }];
  const route = createGoalAcceptRoutes({
    store: {
      group: () => ({ id: "room" }),
      groupTaskByThread: (_group: string, thread: string) => thread === "thread" ? {} : null,
      messagesFor: () => messages,
      patchMessage,
    } as never,
    working: () => options.working ?? false,
    threadRefusal: () => options.refusal ?? null,
    confirmedText: (thread: string) => `confirmed in ${thread}`,
    now: () => 1234,
  });
  const outcome = await route({
    path: `/api/groups/room/tasks/${options.thread ?? "thread"}/goals/${options.card ?? "card"}/accept`,
    method: options.method ?? "POST",
    auth: options.auth ?? OWNER,
    res: {},
    json: (_res: unknown, status: number, body: unknown) => { result = { status, body }; },
  } as unknown as RouteContext);
  return { result, patchMessage, outcome };
}

describe("confirming a goal that stopped for the person", () => {
  it("turns needs-input, paused and limit-reached into completed and says so on the card", async () => {
    for (const status of ["needs-input", "paused", "limit-reached"]) {
      const { result, patchMessage } = await request({ status });
      expect(result?.status).toBe(200);
      expect(patchMessage).toHaveBeenCalledWith("thread", "card", {
        text: "confirmed in thread",
        goalRun: { runId: "run", status: "completed", finishedAt: 1234 },
      });
    }
  });

  it("is idempotent: a goal already completed answers 200 and changes nothing", async () => {
    const { result, patchMessage } = await request({ status: "completed" });
    expect(result?.status).toBe(200);
    expect(patchMessage).not.toHaveBeenCalled();
  });

  it("leaves a running, blocked, failed or stopped goal alone", async () => {
    for (const status of ["working", "blocked", "failed", "stopped"]) {
      const { result, patchMessage } = await request({ status });
      expect(result?.status).toBe(409);
      expect(patchMessage).not.toHaveBeenCalled();
    }
  });

  it("refuses while the room's thread is still working", async () => {
    const { result, patchMessage } = await request({ working: true });
    expect(result?.status).toBe(409);
    expect(patchMessage).not.toHaveBeenCalled();
  });

  it("refuses a bot or viewer: only the owner or an admin confirms", async () => {
    for (const auth of [{ kind: "loopback", trust: "service", scopes: ["client"] }, { kind: "session", scopes: ["client"], session: {}, via: "bearer" }] as RequestAuth[]) {
      const { result, patchMessage } = await request({ auth });
      expect(result?.status).toBe(403);
      expect(patchMessage).not.toHaveBeenCalled();
    }
  });

  it("checks visibility, the conversation and that the message is a goal", async () => {
    for (const [options, status] of [[{ refusal: "private room" }, 403], [{ thread: "other" }, 404], [{ card: "plain" }, 404], [{ card: "missing" }, 404]] as const) {
      const { result, patchMessage } = await request(options);
      expect(result?.status).toBe(status);
      expect(patchMessage).not.toHaveBeenCalled();
    }
  });

  it("passes every other request on", async () => {
    const { outcome, result } = await request({ method: "GET" });
    expect(result).toBeUndefined();
    expect(outcome).toBeDefined();
  });
});
