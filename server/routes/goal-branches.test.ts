import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../request-auth.ts";
import type { RouteContext } from "./table.ts";
import { createGoalBranchRoutes } from "./goal-branches.ts";

async function request(options: { auth?: RequestAuth; body?: unknown; working?: boolean; refusal?: string; thread?: string } = {}) {
  let result: { status: number; body: unknown } | undefined;
  const decide = vi.fn(async () => ({ decision: "kept" }));
  const route = createGoalBranchRoutes({
    store: { group: () => ({ id: "room" }), groupTaskByThread: (_group: string, thread: string) => thread === "thread" ? {} : null, messagesFor: () => [{ id: "card", goalRun: { branches: {}, status: "completed" } }] } as any,
    working: () => options.working ?? false, threadRefusal: () => options.refusal ?? null, decide: decide as any,
  });
  await route({ path: `/api/groups/room/tasks/${options.thread ?? "thread"}/goals/card/branches`, method: "POST", auth: options.auth ?? { kind: "loopback", scopes: ["admin", "client"] }, req: {}, res: {}, url: new URL("http://127.0.0.1"),
    readBody: async () => options.body ?? { action: "keep", head: "a".repeat(40) }, json: (_res: unknown, status: number, body: unknown) => { result = { status, body }; },
  } as unknown as RouteContext);
  return { result, decide };
}

describe("goal branch decision authorization", () => {
  it("refuses viewer and service callers before any Git action", async () => {
    for (const auth of [{ kind: "loopback", trust: "service", scopes: ["client"] }, { kind: "session", scopes: ["client"], session: {}, via: "bearer" }] as RequestAuth[]) {
      const response = await request({ auth });
      expect(response.result?.status).toBe(403); expect(response.decide).not.toHaveBeenCalled();
    }
  });
  it("checks visibility, conversation ownership and active work before any Git action", async () => {
    for (const [options, status] of [[{ refusal: "private room" }, 403], [{ thread: "other-thread" }, 404], [{ working: true }, 409]] as const) {
      const response = await request(options); expect(response.result?.status).toBe(status); expect(response.decide).not.toHaveBeenCalled();
    }
  });
  it("requires an exact head and confirmation for merge and discard", async () => {
    for (const body of [{ action: "discard", head: "a".repeat(40) }, { action: "merge", head: "a".repeat(40) }, { action: "keep", head: "HEAD" }]) {
      const response = await request({ body }); expect(response.result?.status).toBe(400); expect(response.decide).not.toHaveBeenCalled();
    }
    const response = await request({ body: { action: "discard", head: "a".repeat(40), confirm: true } });
    expect(response.result?.status).toBe(200); expect(response.decide).toHaveBeenCalledWith("room", "thread", "card", "discard", "a".repeat(40));
  });
});
