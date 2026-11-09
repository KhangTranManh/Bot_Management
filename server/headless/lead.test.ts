import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerbContext } from "./context.ts";
import { leadPlanVerb } from "./lead.ts";
import { runHeadless } from "./main.ts";
import type { HeadlessIo } from "./output.ts";

const dirs: string[] = [];

function ws(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-lead-cli-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

const goalJson = () =>
  JSON.stringify({
    version: 1,
    id: "g1",
    goal: "go",
    metrics: ["m"],
    budget: { hours: 2, maxRounds: 5 },
    stop: { success: "ok" },
    autonomy: 1,
    createdAt: Date.now(),
  });

function ballot(id: string, over: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    id,
    goalId: "g1",
    title: id,
    reads: [],
    writes: [`out/${id}.txt`],
    locks: [],
    doneWhen: "done",
    role: "implementer",
    model: { instance: "claude", model: "m" },
    dependsOn: [],
    ...over,
  });
}

const ctx = (dir: string, env: NodeJS.ProcessEnv = {}): VerbContext =>
  ({ verb: "lead plan", flags: {}, positionals: [dir], env }) as unknown as VerbContext;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("leadPlanVerb", () => {
  it("is disabled without the flag", async () => {
    const out = await leadPlanVerb(ctx(ws({ "goal.json": goalJson() }), {}));
    expect(out.exitCode).toBe(1);
    expect(out.result).toEqual({ disabled: true });
  });

  it("reports an invalid workspace", async () => {
    const out = await leadPlanVerb(ctx(ws({}), { OMB_LEAD_DEPT_CAP: "1" }));
    expect(out.exitCode).toBe(1);
    expect(out.result).toEqual({ error: expect.stringContaining("goal.json") });
  });

  it("plans two independent tasks in one wave and the dependent one after", async () => {
    const dir = ws({
      "goal.json": goalJson(),
      "tasks/a.json": ballot("a"),
      "tasks/b.json": ballot("b"),
      "tasks/c.json": ballot("c", { dependsOn: ["a", "b"] }),
    });
    const out = await leadPlanVerb(ctx(dir, { OMB_LEAD_DEPT_CAP: "1" }));
    expect(out.exitCode).toBe(0);
    const result = out.result as { waves: string[][]; next: { action: string; wave: Array<{ id: string }> } };
    expect(result.waves).toEqual([["a", "b"], ["c"]]);
    expect(result.next.action).toBe("approve-and-dispatch");
    expect(result.next.wave.map((task) => task.id)).toEqual(["a", "b"]);
  });

  it("fails on a vendor rule violation", async () => {
    const dir = ws({
      "goal.json": goalJson(),
      "tasks/i.json": ballot("i", { role: "implementer", model: { instance: "claude", model: "m" } }),
      "tasks/e.json": ballot("e", { role: "evaluator", model: { instance: "claude", model: "m" }, writes: ["e.txt"] }),
    });
    const out = await leadPlanVerb(ctx(dir, { OMB_LEAD_DEPT_CAP: "1" }));
    expect(out.exitCode).toBe(1);
    expect(out.result).toEqual({ error: expect.stringContaining("share vendor") });
  });
});

describe("lead run", () => {
  function runHarness() {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const callTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "create_task") return { success: true, task: { taskId: "fresh" } };
      if (name === "send_bot_message") return { success: true, botId: args.bot_id, taskId: args.task_id ?? "b-active", messageId: "m1" };
      throw new Error(`unexpected tool ${name}`);
    });
    const io: HeadlessIo = { out: () => undefined, err: () => undefined, readStdin: async () => "" };
    const run = async (argv: string[], env: Record<string, string> = {}) =>
      runHeadless(argv, { env: { OPENMAUSBOT_URL: "http://127.0.0.1:19999", ...env }, io, callTool: callTool as never, request: vi.fn() as never });
    return { calls, run };
  }

  it("sends a self-contained brief to the Lead with the deterministic waves", async () => {
    const dir = ws({ "goal.json": goalJson(), "tasks/a.json": ballot("a"), "tasks/b.json": ballot("b"), "tasks/c.json": ballot("c", { dependsOn: ["a", "b"] }) });
    const h = runHarness();
    const code = await h.run(["lead", "run", dir, "--bot", "lead-bot"], { OMB_LEAD_DEPT_CAP: "1" });
    expect(code).toBe(0);
    const send = h.calls.find((call) => call.name === "send_bot_message");
    expect(send).toBeDefined();
    expect(send!.args.bot_id).toBe("lead-bot");
    expect(String(send!.args.text)).toContain("wave 1: a, b");
    expect(String(send!.args.text)).toContain("wave 2: c");
    expect(String(send!.args.text)).toContain("Autonomy level 1");
  });

  it("is disabled without the flag", async () => {
    const h = runHarness();
    const code = await h.run(["lead", "run", "does-not-exist", "--bot", "lead-bot"], {});
    expect(code).toBe(1);
    expect(h.calls).toEqual([]);
  });
});
