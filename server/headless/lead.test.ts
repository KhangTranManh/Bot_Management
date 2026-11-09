import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VerbContext } from "./context.ts";
import { leadPlanVerb } from "./lead.ts";

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
