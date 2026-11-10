// Real server + the fake engine's real shell: a worker writes actual files in the room folder, and the
// wave's writes audit reports the ones outside its declared writes (detected after the fact).
// The fake engine's scripted Bash runs under /bin/sh, so this file is POSIX-only.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { freePortBlock } from "./testing/ports.ts";

describe.skipIf(process.platform === "win32")("writes audit over the goal loop", () => {
  const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
  const ROOT = join(SERVER_DIR, "..");
  const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");

  let child: ChildProcess;
  let home = "";
  let workspace = "";
  let base = "";
  let stderr = "";

  const planEnvelope = (writes: string) =>
    `Builder takes the page.\n<openmaus-goal>{"status":"continue","detail":"Plan","tasks":[{"id":"t1","assignee":"Builder","instruction":"Add the page","writes":["${writes}"]}]}</openmaus-goal>`;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-writes-audit-"));
    workspace = join(home, "workspace");
    mkdirSync(workspace, { recursive: true });
    await new Promise<void>((resolve, reject) => execFile("git", ["init", "-q"], { cwd: workspace }, (err) => err ? reject(err) : resolve()));
    const data = join(home, ".openmausbot");
    const staticDir = join(home, "static");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(staticDir, "assets"), { recursive: true });
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Writes audit test</title>");
    writeFileSync(join(staticDir, "assets", "smoke.css"), "body{}");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        leadFix: {
          driver: "claudeAgent",
          displayName: "Writes audit lead",
          environment: {
            FAKE_CLAUDE_MODE: "happy",
            FAKE_CLAUDE_REPLIES: JSON.stringify([
              planEnvelope("page.tsx"),
              "Both files are in place.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Page added.\"}</openmaus-goal>",
              planEnvelope("page.tsx"),
              "Page added cleanly.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Page added again.\"}</openmaus-goal>",
            ]),
            FAKE_CLAUDE_REPLY_STATE: join(home, "lead-replies.txt"),
          },
          config: { cli: FAKE_CLAUDE },
        },
        workerDirty: {
          driver: "claudeAgent",
          displayName: "Writes audit dirty worker",
          environment: {
            FAKE_CLAUDE_MODE: "happy",
            FAKE_CLAUDE_REPLIES: JSON.stringify(["Added the page."]),
            FAKE_CLAUDE_REPLY_STATE: join(home, "worker-dirty-replies.txt"),
            FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([{ name: "Bash", input: { command: "printf page > page.tsx; printf stray > stray.txt" } }]),
            FAKE_CLAUDE_RUN_BASH: "1",
          },
          config: { cli: FAKE_CLAUDE },
        },
        workerClean: {
          driver: "claudeAgent",
          displayName: "Writes audit clean worker",
          environment: {
            FAKE_CLAUDE_MODE: "happy",
            FAKE_CLAUDE_REPLIES: JSON.stringify(["Added the page."]),
            FAKE_CLAUDE_REPLY_STATE: join(home, "worker-clean-replies.txt"),
            FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([{ name: "Bash", input: { command: "printf page > page.tsx" } }]),
            FAKE_CLAUDE_RUN_BASH: "1",
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
  const roomMessages = async (roomId: string) =>
    (await api("GET", "/api/bots?messages=30")).body.groups.find((group: any) => group.id === roomId)?.messages ?? [];
  const activities = async (roomId: string) => (await roomMessages(roomId))
    .filter((message: any) => message.kind === "activity")
    .map((message: any) => message.tool?.name ?? "");

  it.each([
    ["workerDirty", "stray.txt"],
    ["workerClean", "page.tsx"],
  ])("a wave worker writing through %s leaves the writes audit row it deserves", async (instance, written) => {
    const lead = (await api("POST", "/api/bots", {
      name: `Planner ${instance}`,
      modelSelection: { instanceId: "leadFix", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const worker = (await api("POST", "/api/bots", {
      name: `Builder ${instance}`,
      modelSelection: { instanceId: instance, model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: `Build ${instance}`, memberIds: [lead.id, worker.id], setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    expect((await api("PATCH", `/api/groups/${room.id}`, { cwd: workspace })).status).toBe(200);

    const sent = await api("POST", `/api/groups/${room.id}/messages`, {
      text: "Add the page",
      mode: "goal",
      sendId: `goal_send_writes_${instance}`,
    });
    expect(sent.status).toBe(202);

    await expect.poll(async () => (await roomMessages(room.id)).find((message: any) => message.kind === "goal.run")?.goalRun?.status, { timeout: hostTimeout(30_000) })
      .toBe("completed");

    const rows = await activities(room.id);
    const auditRow = rows.find((name: string) => name.includes("outside their declared writes"));
    if (instance === "workerDirty") {
      expect(auditRow).toContain("Builder");
      expect(auditRow).toContain("stray.txt");
    } else {
      expect(auditRow).toBeUndefined();
    }
    expect(rows.some((name: string) => name.includes(written) && name.includes("outside"))).toBe(false);
    expect(JSON.stringify(await roomMessages(room.id))).not.toContain("<openmaus-goal>");
  });
});
