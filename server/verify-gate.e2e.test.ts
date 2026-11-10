// Real server: the room's verify commands run server-side (B0(ii)) — a passing check lets the goal
// finish and its artifact appears in the room folder; a failing check burns the fix rounds to blocked.
// The commands run under the platform shell via execFile(..., { shell: true }); these ones are POSIX.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { freePortBlock } from "./testing/ports.ts";

describe.skipIf(process.platform === "win32")("room verify gate", () => {
  const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
  const ROOT = join(SERVER_DIR, "..");
  const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");

  let child: ChildProcess;
  let home = "";
  let workspace = "";
  let base = "";
  let stderr = "";

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-verify-gate-"));
    workspace = join(home, "workspace");
    mkdirSync(workspace, { recursive: true });
    const data = join(home, ".openmausbot");
    const staticDir = join(home, "static");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(staticDir, "assets"), { recursive: true });
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Verify gate test</title>");
    writeFileSync(join(staticDir, "assets", "smoke.css"), "body{}");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        leadFix: {
          driver: "claudeAgent",
          displayName: "Verify gate lead",
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
          displayName: "Verify gate worker",
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

  it("runs the room's verify command itself and lets a passing goal finish", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Gate planner",
      modelSelection: { instanceId: "leadFix", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const worker = (await api("POST", "/api/bots", {
      name: "Gate builder",
      modelSelection: { instanceId: "workerFix", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", { name: "Gate room", memberIds: [lead.id, worker.id] })).body.group;
    expect((await api("PATCH", `/api/groups/${room.id}`, {
      cwd: workspace,
      verify: [{ id: "write-check", command: "printf ran > verify-ran.txt" }],
    })).status).toBe(200);

    const sent = await api("POST", `/api/groups/${room.id}/messages`, { text: "Add the page", mode: "goal", sendId: "goal_send_verify_pass" });
    expect(sent.status).toBe(202);

    await expect.poll(async () => (await api("GET", "/api/bots?messages=30")).body.groups
      .find((group: any) => group.id === room.id)?.messages.find((message: any) => message.kind === "goal.run")?.goalRun?.status, { timeout: hostTimeout(30_000) })
      .toBe("completed");
    // The command's artifact is the proof the server, not a bot, ran the check.
    expect(existsSync(join(workspace, "verify-ran.txt"))).toBe(true);
  });

  it("a failing verify command burns the fix rounds and blocks the run", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Failing planner",
      modelSelection: { instanceId: "leadFix", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const worker = (await api("POST", "/api/bots", {
      name: "Failing builder",
      modelSelection: { instanceId: "workerFix", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", { name: "Failing gate room", memberIds: [lead.id, worker.id] })).body.group;
    expect((await api("PATCH", `/api/groups/${room.id}`, {
      cwd: workspace,
      verify: [{ id: "never-green", command: "false" }],
    })).status).toBe(200);

    const sent = await api("POST", `/api/groups/${room.id}/messages`, { text: "Add the page", mode: "goal", sendId: "goal_send_verify_fail" });
    expect(sent.status).toBe(202);

    await expect.poll(async () => (await api("GET", "/api/bots?messages=30")).body.groups
      .find((group: any) => group.id === room.id)?.messages.find((message: any) => message.kind === "goal.run")?.goalRun?.status, { timeout: hostTimeout(60_000) })
      .toBe("blocked");
    const card = (await api("GET", "/api/bots?messages=30")).body.groups.find((group: any) => group.id === room.id)
      ?.messages.find((message: any) => message.kind === "goal.run");
    expect(card.goalRun.detail).toContain("kept failing after 3 fix rounds");
  }, 120_000);
});
