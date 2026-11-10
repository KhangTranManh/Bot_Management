// Real server: a research room (kind "research") never starts a goal softly — the goal file must validate,
// be approved (hash locked), its own verify commands run server-side, and its metric must clear the
// threshold. The check commands run under the platform shell; POSIX-only.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { freePortBlock } from "./testing/ports.ts";

describe.skipIf(process.platform === "win32")("research room goal gate", () => {
  const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
  const ROOT = join(SERVER_DIR, "..");
  const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");

  let child: ChildProcess;
  let home = "";
  let workspace = "";
  let base = "";
  let stderr = "";

  const goalJson = (threshold: number) => JSON.stringify({
    name: "Phase 16 sweep",
    metric: { file: "results/metrics.json", pointer: "/primary/accuracy", threshold, direction: "at-least" },
    seeds: { count: 3, aggregation: "mean" },
    budget: { wallMinutes: 90 },
    verify: [{
      id: "marker",
      command: `printf ran > verify-ran.txt && mkdir -p results && printf '%s' '{"primary":{"accuracy":[0.7,0.75,0.8]}}' > results/metrics.json`,
    }],
  });

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-research-gate-"));
    workspace = join(home, "workspace");
    mkdirSync(workspace, { recursive: true });
    const data = join(home, ".openmausbot");
    const staticDir = join(home, "static");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(staticDir, "assets"), { recursive: true });
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Research gate test</title>");
    writeFileSync(join(staticDir, "assets", "smoke.css"), "body{}");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        leadFix: {
          driver: "claudeAgent",
          displayName: "Research gate lead",
          environment: {
            FAKE_CLAUDE_MODE: "happy",
            FAKE_CLAUDE_REPLIES: JSON.stringify([
              "Builder takes the page.\n<openmaus-goal>{\"status\":\"continue\",\"detail\":\"Plan\",\"tasks\":[{\"id\":\"t1\",\"assignee\":\"Builder\",\"instruction\":\"Add the page\",\"writes\":[\"page.tsx\"]}]}</openmaus-goal>",
              "Done.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Page added.\"}</openmaus-goal>",
            ]),
            FAKE_CLAUDE_REPLY_STATE: join(home, "lead-replies.txt"),
          },
          config: { cli: FAKE_CLAUDE },
        },
        workerFix: {
          driver: "claudeAgent",
          displayName: "Research gate worker",
          environment: {
            FAKE_CLAUDE_MODE: "happy",
            FAKE_CLAUDE_REPLIES: JSON.stringify(["Added the page."]),
            FAKE_CLAUDE_REPLY_STATE: join(home, "worker-replies.txt"),
          },
          config: { cli: FAKE_CLAUDE },
        },
      },
    }, null, 2));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "index.ts")], {
      cwd: ROOT,
      env: {
        PATH: [dirname(process.execPath), ...(process.env.PATH ? [process.env.PATH] : [])].join(delimiter),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home,
        USERPROFILE: home,
        OMB_PORT: String(port),
        OMB_WEBHOOK_PORT: String(port + 1),
        OMB_STATIC_DIR: staticDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
      try {
        if ((await fetch(`${base}/api/health`)).status === 200) break;
      } catch {
      }
      if (Date.now() >= deadline) throw new Error(`server never became healthy: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, 30_000);

  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    if (home) await removeTempDir(home);
  });

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method,
      headers: { "content-type": "application/json", origin: base },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json() as any } as { status: number; body: any };
  };
  const cardOf = async (roomId: string) => (await api("GET", "/api/bots?messages=30")).body.groups
    .find((group: any) => group.id === roomId)?.messages.find((message: any) => message.kind === "goal.run")?.goalRun;

  it("the gate, the approval lock and the goal file's own verify commands hold end to end", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Research planner",
      modelSelection: { instanceId: "leadFix", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const worker = (await api("POST", "/api/bots", {
      name: "Research builder",
      modelSelection: { instanceId: "workerFix", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Research lab", memberIds: [lead.id, worker.id], setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    expect((await api("PATCH", `/api/groups/${room.id}`, { kind: "research", cwd: workspace, goalFile: "goal.json" })).status).toBe(200);

    // No goal file on disk yet: the run stops at needs-input instead of starting softly.
    let sent = await api("POST", `/api/groups/${room.id}/messages`, { text: "Run the sweep", mode: "goal", sendId: "goal_send_research_1" });
    expect(sent.status).toBe(202);
    await expect.poll(async () => (await cardOf(room.id))?.status, { timeout: hostTimeout(15_000) }).toBe("needs-input");
    expect((await cardOf(room.id)).detail).toContain("has no goal file set");

    // A broken file is refused at approval time with the schema reason.
    writeFileSync(join(workspace, "goal.json"), "{not json");
    expect((await api("PATCH", `/api/groups/${room.id}`, { researchGoalApprove: true })).status).toBe(400);

    // A valid file approves, and the run's verify comes from the file, run by the server.
    writeFileSync(join(workspace, "goal.json"), goalJson(0.72));
    expect((await api("PATCH", `/api/groups/${room.id}`, { researchGoalApprove: true })).status).toBe(200);
    sent = await api("POST", `/api/groups/${room.id}/messages`, { text: "Run the sweep", mode: "goal", sendId: "goal_send_research_2" });
    expect(sent.status).toBe(202);
    await expect.poll(async () => (await cardOf(room.id))?.status, { timeout: hostTimeout(30_000) }).toBe("completed");
    expect(existsSync(join(workspace, "verify-ran.txt"))).toBe(true);
    // The ledger is the server's, in its data folder, not in the room folder the bots write to.
    const ledger = readFileSync(join(home, ".openmausbot", "research", `${room.id}.jsonl`), "utf8");
    expect(ledger).toContain('"kind":"metric"');
    expect(existsSync(join(workspace, "ledger.jsonl"))).toBe(false);

    // Preregistration lock: the approved file edited on disk blocks the next run.
    writeFileSync(join(workspace, "goal.json"), goalJson(0.99));
    sent = await api("POST", `/api/groups/${room.id}/messages`, { text: "Run the sweep", mode: "goal", sendId: "goal_send_research_3" });
    expect(sent.status).toBe(202);
    await expect.poll(async () => (await cardOf(room.id))?.status, { timeout: hostTimeout(15_000) }).toBe("blocked");
    expect((await cardOf(room.id)).detail).toContain("preregistration lock");
  }, 180_000);
});
