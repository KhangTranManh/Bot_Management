import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");

let child: ChildProcess;
let home = "";
let stopScopedWorkerFinishGate = "";
let busyWorkerFinishGate = "";
let busyGoalFinishGate = "";
let routineGoalFinishGate = "";
let queueFinishGate = "";
let stopScopedLeadFinishGate = "";
let waveHeldFinishGate = "";
let optimizedFinishGate = "";
let sideHeldFinishGate = "";
let chatSlowFinishGate = "";
let base = "";
let stderr = "";

const completeReplies = [
  [
    "Scout should verify the draft.\n<openmaus-goal>{\"status\":\"continue\",",
    "\"next\":\"Scout\",\"instruction\":\"Verify the draft and report evidence\",\"detail\":\"Draft prepared\"}</openmaus-goal>",
  ],
  "The draft is accurate and the cited evidence checks out.",
  "The verified draft is ready to ship.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Draft produced and independently verified.\"}</openmaus-goal>",
];

const loopReplies = Array.from({ length: 13 }, (_, index) =>
  index % 2 === 0
    ? `More work is needed.\n<openmaus-goal>{"status":"continue","next":"Looper","instruction":"Try approach ${index / 2 + 1}","detail":"Still working"}</openmaus-goal>`
    : `Approach ${Math.ceil(index / 2)} did not finish the task.`,
);

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-goal-run-"));
  stopScopedWorkerFinishGate = join(home, "stop-scoped-worker-finish");
  busyWorkerFinishGate = join(home, "busy-worker-finish");
  busyGoalFinishGate = join(home, "busy-goal-finish");
  routineGoalFinishGate = join(home, "routine-goal-finish");
  queueFinishGate = join(home, "queue-finish");
  stopScopedLeadFinishGate = join(home, "stop-scoped-lead-finish");
  waveHeldFinishGate = join(home, "wave-held-finish");
  optimizedFinishGate = join(home, "optimized-finish");
  sideHeldFinishGate = join(home, "side-held-finish");
  chatSlowFinishGate = join(home, "chat-slow-finish");
  writeFileSync(stopScopedLeadFinishGate, "allow initial goal delegation");
  const data = join(home, ".openmausbot");
  const staticDir = join(home, "static");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Goal run test</title>");
  writeFileSync(join(staticDir, "assets", "smoke.css"), "body{}");
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: {
      optimizedLead: {
        driver: "claudeAgent", displayName: "Optimized lead",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            'Plan.\n<openmaus-goal>{"status":"continue","detail":"Independent modules","brief":{"goal":"Build independent a.ts and b.ts"},"tasks":[{"id":"a","assignee":"Held worker","instruction":"Build a.ts","writes":["a.ts"]},{"id":"b","assignee":"Free worker","instruction":"Build b.ts","writes":["b.ts"]}]}</openmaus-goal>',
            'Reviewed.\n<openmaus-goal>{"status":"completed","detail":"Built, tested and reviewed."}</openmaus-goal>',
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "optimized-lead-replies.txt"),
        }, config: { cli: FAKE_CLAUDE },
      },
      optimizedTester: {
        driver: "claudeAgent", displayName: "Optimized tester",
        environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_REPLIES: JSON.stringify(["Checks pass.\nVERDICT: PASS"]) }, config: { cli: FAKE_CLAUDE },
      },
      optimizedHeld: {
        driver: "claudeAgent", displayName: "Optimized held worker",
        environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: optimizedFinishGate, FAKE_CLAUDE_REPLIES: JSON.stringify(["Built a.ts."]) }, config: { cli: FAKE_CLAUDE },
      },
      optimizedFree: {
        driver: "claudeAgent", displayName: "Optimized free worker",
        environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_REPLIES: JSON.stringify(["Built b.ts."]) }, config: { cli: FAKE_CLAUDE },
      },
      optimizedReviewer: {
        driver: "claudeAgent", displayName: "Optimized reviewer",
        environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_REPLIES: JSON.stringify(["Reviewed a.ts and b.ts. No findings.\nREVIEW: CLEAR"]) }, config: { cli: FAKE_CLAUDE },
      },
      blockLead: {
        driver: "claudeAgent", displayName: "Block lead",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            'Plan.\n<openmaus-goal>{"status":"continue","detail":"One module","brief":{"goal":"Build c.ts"},"tasks":[{"id":"c","assignee":"Block worker","instruction":"Build c.ts","writes":["c.ts"]}]}</openmaus-goal>',
            'Done.\n<openmaus-goal>{"status":"completed","detail":"Built and tested."}</openmaus-goal>',
            'Done.\n<openmaus-goal>{"status":"completed","detail":"Built; rounding is out of scope for this goal."}</openmaus-goal>',
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "block-lead-replies.txt"),
        }, config: { cli: FAKE_CLAUDE },
      },
      blockWorker: {
        driver: "claudeAgent", displayName: "Block worker",
        environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_REPLIES: JSON.stringify(["Built c.ts."]) }, config: { cli: FAKE_CLAUDE },
      },
      blockTester: {
        driver: "claudeAgent", displayName: "Block tester",
        environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_REPLIES: JSON.stringify(["Checks pass.\nVERDICT: PASS"]) }, config: { cli: FAKE_CLAUDE },
      },
      blockReviewer: {
        driver: "claudeAgent", displayName: "Block reviewer",
        environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_REPLIES: JSON.stringify(["FINDING: block c c.ts:7 — the total rounds down\nREVIEW: BLOCK 1"]) }, config: { cli: FAKE_CLAUDE },
      },
      complete: {
        driver: "claudeAgent",
        displayName: "Completing fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(completeReplies),
          FAKE_CLAUDE_REPLY_STATE: join(home, "complete-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      loop: {
        driver: "claudeAgent",
        displayName: "Looping fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(loopReplies),
          FAKE_CLAUDE_REPLY_STATE: join(home, "loop-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      crash: {
        driver: "claudeAgent",
        displayName: "Failing fixture",
        environment: { FAKE_CLAUDE_MODE: "exit-early" },
        config: { cli: FAKE_CLAUDE },
      },
      slow: {
        driver: "claudeAgent",
        displayName: "Queue fixture",
        environment: {
          FAKE_CLAUDE_MODE: "slow",
          FAKE_CLAUDE_SLOW_FINISH_GATE: queueFinishGate,
          FAKE_CLAUDE_REPLIES: JSON.stringify(["first response", "second response"]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "slow-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      busyGoal: {
        driver: "claudeAgent",
        displayName: "Busy goal fixture",
        environment: {
          FAKE_CLAUDE_MODE: "slow",
          FAKE_CLAUDE_SLOW_FINISH_GATE: busyGoalFinishGate,
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            "The unrelated direct task is complete.",
            "The queued team goal is complete.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Waited for the lead, then completed normally.\"}</openmaus-goal>",
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "busy-goal-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      busyWorkerLead: {
        driver: "claudeAgent",
        displayName: "Busy worker lead fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            "I am delegating the research.\n<openmaus-goal>{\"status\":\"continue\",\"next\":\"Busy specialist\",\"instruction\":\"Research the answer and report evidence\",\"detail\":\"Waiting for specialist research.\"}</openmaus-goal>",
            "The specialist's evidence resolves the goal.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Specialist research incorporated after their direct task finished.\"}</openmaus-goal>",
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "busy-worker-lead-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      busyWorker: {
        driver: "claudeAgent",
        displayName: "Busy worker fixture",
        environment: {
          FAKE_CLAUDE_MODE: "slow",
          FAKE_CLAUDE_SLOW_FINISH_GATE: busyWorkerFinishGate,
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            "The unrelated direct research is complete.",
            "Evidence gathered for the coordinator.",
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "busy-worker-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      stopScopedLead: {
        driver: "claudeAgent",
        displayName: "Stop-scoped lead fixture",
        environment: {
          FAKE_CLAUDE_MODE: "slow",
          FAKE_CLAUDE_SLOW_FINISH_GATE: stopScopedLeadFinishGate,
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            "I am delegating this scheduled goal.\n<openmaus-goal>{\"status\":\"continue\",\"next\":\"Delayed worker\",\"instruction\":\"Finish the scheduled analysis\",\"detail\":\"Waiting for the delayed worker.\"}</openmaus-goal>",
            "This is unrelated direct work and should be stopped.",
            "The scheduled analysis is now complete.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Scheduled goal survived the coordinator's direct Stop.\"}</openmaus-goal>",
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "stop-scoped-lead-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      stopScopedWorker: {
        driver: "claudeAgent",
        displayName: "Stop-scoped worker fixture",
        environment: {
          FAKE_CLAUDE_MODE: "background-result",
          FAKE_CLAUDE_FINISH_GATE: stopScopedWorkerFinishGate,
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            "The worker's unrelated direct task completed naturally.",
            "Scheduled analysis returned to the coordinator.",
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "stop-scoped-worker-replies.txt"),
          FAKE_CLAUDE_TRANSIENTS: "1",
          FAKE_CLAUDE_STATE: join(home, "stop-scoped-worker-launches.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      directHang: {
        driver: "claudeAgent",
        displayName: "Direct hang fixture",
        environment: { FAKE_CLAUDE_MODE: "hang" },
        config: { cli: FAKE_CLAUDE },
      },
      routineGoal: {
        driver: "claudeAgent",
        displayName: "Routine goal fixture",
        environment: {
          FAKE_CLAUDE_MODE: "slow",
          FAKE_CLAUDE_SLOW_FINISH_GATE: routineGoalFinishGate,
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            "The scheduled review is complete.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Scheduled team review completed.\"}</openmaus-goal>",
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "routine-goal-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      chatSlow: {
        driver: "claudeAgent",
        displayName: "Chat slow fixture",
        environment: {
          FAKE_CLAUDE_MODE: "slow",
          FAKE_CLAUDE_SLOW_FINISH_GATE: chatSlowFinishGate,
          FAKE_CLAUDE_REPLIES: JSON.stringify(["Slow work finished."]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "chat-slow-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      chatFree: {
        driver: "claudeAgent",
        displayName: "Chat free fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(["The slow teammate is still on it."]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "chat-free-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      roleLead: {
        driver: "claudeAgent",
        displayName: "Role lead fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            "Builder takes the page.\n<openmaus-goal>{\"status\":\"continue\",\"detail\":\"Plan\",\"brief\":{\"goal\":\"Build the page\"},\"tasks\":[{\"id\":\"t1\",\"assignee\":\"Role builder\",\"instruction\":\"Add the page\",\"writes\":[\"page.tsx\"]}]}</openmaus-goal>",
            "Tested and done.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Page added and tested.\"}</openmaus-goal>",
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "role-lead-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      roleWorker: {
        driver: "claudeAgent",
        displayName: "Role worker fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(["Added page.tsx."]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "role-worker-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      roleTester: {
        driver: "claudeAgent",
        displayName: "Role tester fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(["Build and tests pass.\nVERDICT: PASS"]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "role-tester-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      autoLead: {
        driver: "claudeAgent",
        displayName: "Auto lead fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(Array(6).fill("Done.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Home page built.\"}</openmaus-goal>")),
          FAKE_CLAUDE_REPLY_STATE: join(home, "auto-lead-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      limitLead: {
        driver: "claudeAgent",
        displayName: "Limit lead fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            "Maple builds.\n<openmaus-goal>{\"status\":\"continue\",\"detail\":\"Plan\",\"brief\":{\"goal\":\"Build the page\"},\"tasks\":[{\"id\":\"t1\",\"assignee\":\"Limit maple\",\"instruction\":\"Build the UI\",\"writes\":[\"ui.tsx\"]}]}</openmaus-goal>",
            "Clover takes it.\n<openmaus-goal>{\"status\":\"continue\",\"detail\":\"Moved\",\"tasks\":[{\"id\":\"t1\",\"assignee\":\"Limit clover\",\"instruction\":\"Build the UI\",\"writes\":[\"ui.tsx\"]}]}</openmaus-goal>",
            "Done.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"UI built by Clover.\"}</openmaus-goal>",
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "limit-lead-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      limitOut: {
        driver: "claudeAgent",
        displayName: "Limit out fixture",
        environment: { FAKE_CLAUDE_MODE: "usage-limit" },
        config: { cli: FAKE_CLAUDE },
      },
      limitIn: {
        driver: "claudeAgent",
        displayName: "Limit in fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(["Built ui.tsx.", "Checked.\nVERDICT: PASS"]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "limit-in-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      sideLead: {
        driver: "claudeAgent",
        displayName: "Side lead fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            "Splitting up.\n<openmaus-goal>{\"status\":\"continue\",\"detail\":\"Plan\",\"tasks\":[{\"id\":\"t1\",\"assignee\":\"Side held\",\"instruction\":\"Draft and report\",\"writes\":[\"plan.md\"]}]}</openmaus-goal>",
            "Done.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Side goal done.\"}</openmaus-goal>",
            "Done.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Side goal done.\"}</openmaus-goal>",
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "side-lead-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      sideHeld: {
        driver: "claudeAgent",
        displayName: "Side held fixture",
        environment: {
          FAKE_CLAUDE_MODE: "slow",
          FAKE_CLAUDE_SLOW_FINISH_GATE: sideHeldFinishGate,
          FAKE_CLAUDE_REPLIES: JSON.stringify(["Drafted and reported."]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "side-held-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      sideFree: {
        driver: "claudeAgent",
        displayName: "Side free fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(["Going fine, the draft is in progress."]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "side-free-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      waveLead: {
        driver: "claudeAgent",
        displayName: "Wave lead fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify([
            "I am splitting the work.\n<openmaus-goal>{\"status\":\"continue\",\"detail\":\"Two-part plan\",\"tasks\":[{\"id\":\"t1\",\"assignee\":\"Held worker\",\"instruction\":\"Draft the launch plan and report\",\"writes\":[\"plan.md\"]},{\"id\":\"t2\",\"assignee\":\"Free worker\",\"instruction\":\"List the launch risks and report\"}]}</openmaus-goal>",
            "Both parts are in.\n<openmaus-goal>{\"status\":\"completed\",\"detail\":\"Plan drafted and risks listed.\"}</openmaus-goal>",
          ]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "wave-lead-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      waveHeld: {
        driver: "claudeAgent",
        displayName: "Wave held fixture",
        environment: {
          FAKE_CLAUDE_MODE: "slow",
          FAKE_CLAUDE_SLOW_FINISH_GATE: waveHeldFinishGate,
          FAKE_CLAUDE_REPLIES: JSON.stringify(["Drafted the launch plan and reported."]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "wave-held-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      waveFree: {
        driver: "claudeAgent",
        displayName: "Wave free fixture",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(["Listed the launch risks and reported."]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "wave-free-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
    },
  }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      // The fake CLI is a .ts file with a node shebang; the server resolves node
      // through this PATH, so the runner's own node must lead it.
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

describe("goal-driven channel runs", () => {
  it("runs independent Workers together and automatically tests and reviews their work", async () => {
    const make = async (name: string, instanceId: string) => (await api("POST", "/api/bots", { name, modelSelection: { instanceId, model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;
    const lead = await make("Optimized lead", "optimizedLead");
    const held = await make("Held worker", "optimizedHeld");
    const free = await make("Free worker", "optimizedFree");
    const tester = await make("Optimized tester", "optimizedTester");
    const reviewer = await make("Optimized reviewer", "optimizedReviewer");
    const room = (await api("POST", "/api/groups", {
      name: "Optimized team", memberIds: [lead.id, held.id, free.id, tester.id, reviewer.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    expect((await api("PATCH", `/api/groups/${room.id}`, { roles: { [lead.id]: "lead", [held.id]: "worker", [free.id]: "worker", [tester.id]: "tester", [reviewer.id]: "reviewer" } })).status).toBe(200);
    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Build independent a.ts and b.ts, test and review", mode: "goal", sendId: "goal_optimized_1234567890" })).status).toBe(202);
    const state = async () => (await api("GET", "/api/bots?messages=80")).body.groups.find((candidate: { id: string }) => candidate.id === room.id);
    const results = (current: any) => current.messages.filter((message: any) => message.roomRequest?.phase === "result").map((message: any) => message.from?.name);
    try {
      await expect.poll(async () => results(await state()), { timeout: hostTimeout(20_000) }).toContain("Free worker");
      expect(results(await state())).not.toContain("Held worker");
      expect(results(await state())).not.toContain("Optimized tester");
      expect(results(await state())).not.toContain("Optimized reviewer");
    } finally {
      writeFileSync(optimizedFinishGate, "release optimized worker");
    }
    await expect.poll(async () => (await state()).messages.find((message: any) => message.kind === "goal.run")?.goalRun, { timeout: hostTimeout(20_000) })
      .toMatchObject({ status: "completed", turnCount: 4, detail: "Built, tested and reviewed." });
    expect(results(await state()).sort()).toEqual(["Free worker", "Held worker", "Optimized reviewer", "Optimized tester"].sort());
  });

  it("holds completion once on a Reviewer's blocking finding and records the Lead setting it aside", async () => {
    const make = async (name: string, instanceId: string) => (await api("POST", "/api/bots", { name, modelSelection: { instanceId, model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;
    const lead = await make("Block lead", "blockLead");
    const worker = await make("Block worker", "blockWorker");
    const tester = await make("Block tester", "blockTester");
    const reviewer = await make("Block reviewer", "blockReviewer");
    const room = (await api("POST", "/api/groups", {
      name: "Block team", memberIds: [lead.id, worker.id, tester.id, reviewer.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    expect((await api("PATCH", `/api/groups/${room.id}`, { roles: { [lead.id]: "lead", [worker.id]: "worker", [tester.id]: "tester", [reviewer.id]: "reviewer" } })).status).toBe(200);
    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Build c.ts, test and review", mode: "goal", sendId: "goal_block_review_1234567890" })).status).toBe(202);
    const state = async () => (await api("GET", "/api/bots?messages=80")).body.groups.find((candidate: { id: string }) => candidate.id === room.id);
    await expect.poll(async () => (await state()).messages.find((message: any) => message.kind === "goal.run")?.goalRun, { timeout: hostTimeout(20_000) })
      .toMatchObject({ status: "completed", turnCount: 5, detail: "Built; rounding is out of scope for this goal.", brief: { goal: "Build c.ts", acceptance: [], openQuestions: [] } });
    expect((await state()).messages.some((message: any) => message.kind === "activity" && message.tool?.name?.includes("blocking findings set aside: Built; rounding is out of scope"))).toBe(true);
  });

  it("returns to the lead until the goal is completed and appends a clean receipt", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Lead",
      modelSelection: { instanceId: "complete", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const scout = (await api("POST", "/api/bots", {
      name: "Scout",
      modelSelection: { instanceId: "complete", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Launch team",
      memberIds: [lead.id, scout.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;

    const sent = await api("POST", `/api/groups/${room.id}/messages`, {
      text: "Produce and verify the launch draft",
      mode: "goal",
      sendId: "goal_send_1234567890",
    });
    expect(sent.status).toBe(202);
    expect(sent.body.message).toMatchObject({ channelMode: "goal" });

    await expect.poll(async () => {
      const state = (await api("GET", "/api/bots?messages=30")).body;
      const current = state.groups.find((candidate: { id: string }) => candidate.id === room.id);
      return current?.messages.find((message: { kind: string }) => message.kind === "goal.run")?.goalRun;
    }, { timeout: hostTimeout(10_000) }).toMatchObject({
      status: "completed",
      coordinatorBotId: lead.id,
      turnCount: 3,
      detail: "Draft produced and independently verified.",
    });

    const state = (await api("GET", "/api/bots?messages=30")).body;
    const current = state.groups.find((candidate: { id: string }) => candidate.id === room.id);
    expect(current.messages.find((message: { kind: string }) => message.kind === "goal.run")?.text)
      .toBe("Goal completed: Draft produced and independently verified.");
    expect(current.working).toBe(false);
    expect(current.messages.filter((message: { kind: string; role?: string }) => message.kind === "text" && message.role === "bot")
      .map((message: { from?: { name?: string } }) => message.from?.name)).toEqual(["Lead", "Scout", "Lead"]);
    expect(JSON.stringify(current.messages)).not.toContain("<openmaus-goal>");
  });

  it("waits for a busy coordinator without spending a goal turn, then completes on the same card", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Patient lead",
      modelSelection: { instanceId: "busyGoal", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Patient goal team",
      memberIds: [lead.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;

    try {
      expect((await api("POST", `/api/bots/${lead.id}/messages`, { text: "Finish this direct task first" })).status)
        .toBe(202);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=0")).body;
        return state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy;
      }).toBe(true);

      expect((await api("POST", `/api/groups/${room.id}/messages`, {
        text: "Complete this goal after your current work",
        mode: "goal",
      })).status).toBe(202);

      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        const cards = current?.messages.filter((message: { kind: string }) => message.kind === "goal.run") ?? [];
        return {
          count: cards.length,
          status: cards[0]?.goalRun?.status,
          detail: cards[0]?.goalRun?.detail,
          turnCount: cards[0]?.goalRun?.turnCount,
          busyBotId: current?.busyBotId,
        };
      }).toMatchObject({
        count: 1,
        status: "working",
        detail: expect.stringMatching(/finishing another conversation/i),
        turnCount: 0,
        busyBotId: null,
      });

      const waitingState = (await api("GET", "/api/bots?messages=30")).body;
      const waitingRoom = waitingState.groups.find((group: { id: string }) => group.id === room.id);
      const cardId = waitingRoom.messages.find((message: { kind: string }) => message.kind === "goal.run").id;
      // Release only after the wait card is observed, so slow startup cannot use up the fake's completion window.
      writeFileSync(busyGoalFinishGate, "observed the waiting goal");

      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        const cards = current?.messages.filter((message: { kind: string }) => message.kind === "goal.run") ?? [];
        return {
          working: current?.working,
          count: cards.length,
          id: cards[0]?.id,
          status: cards[0]?.goalRun?.status,
          detail: cards[0]?.goalRun?.detail,
          turnCount: cards[0]?.goalRun?.turnCount,
        };
      }, { timeout: hostTimeout(10_000) }).toEqual({
        working: false,
        count: 1,
        id: cardId,
        status: "completed",
        detail: "Waited for the lead, then completed normally.",
        turnCount: 1,
      });
    } finally {
      await api("POST", `/api/groups/${room.id}/interrupt`, {}).catch(() => undefined);
      await api("POST", `/api/bots/${lead.id}/interrupt`, {}).catch(() => undefined);
      await api("DELETE", `/api/groups/${room.id}`).catch(() => undefined);
      await api("DELETE", `/api/bots/${lead.id}`).catch(() => undefined);
    }
  });

  it("waits for a busy delegated worker, preserves its direct turn, then resumes the goal", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Worker coordinator",
      modelSelection: { instanceId: "busyWorkerLead", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const worker = (await api("POST", "/api/bots", {
      name: "Busy specialist",
      modelSelection: { instanceId: "busyWorker", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Busy specialist team",
      memberIds: [lead.id, worker.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;

    try {
      expect((await api("POST", `/api/bots/${worker.id}/messages`, {
        text: "Complete this unrelated direct research first",
      })).status).toBe(202);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=0")).body;
        return state.bots.find((bot: { id: string }) => bot.id === worker.id)?.busy;
      }).toBe(true);

      expect((await api("POST", `/api/groups/${room.id}/messages`, {
        text: "Research and resolve the team question",
        mode: "goal",
      })).status).toBe(202);

      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        const card = current?.messages.find((message: { kind: string }) => message.kind === "goal.run");
        return {
          status: card?.goalRun?.status,
          detail: card?.goalRun?.detail,
          turnCount: card?.goalRun?.turnCount,
          roomBusyBotId: current?.busyBotId,
          workerDirectBusy: state.bots.find((bot: { id: string }) => bot.id === worker.id)?.busy,
        };
      }).toMatchObject({
        status: "working",
        detail: expect.stringMatching(/Busy specialist is finishing another conversation/i),
        turnCount: 1,
        roomBusyBotId: null,
        workerDirectBusy: true,
      });

      // Hold the worker until the waiting state is observed, even past the fake's default 800 ms turn.
      writeFileSync(busyWorkerFinishGate, "release");

      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        const currentWorker = state.bots.find((bot: { id: string }) => bot.id === worker.id);
        const cards = current?.messages.filter((message: { kind: string }) => message.kind === "goal.run") ?? [];
        return {
          roomWorking: current?.working,
          cards: cards.length,
          status: cards[0]?.goalRun?.status,
          detail: cards[0]?.goalRun?.detail,
          turnCount: cards[0]?.goalRun?.turnCount,
          speakers: current?.messages
            .filter((message: { kind: string; role?: string }) => message.kind === "text" && message.role === "bot")
            .map((message: { from?: { name?: string } }) => message.from?.name)
            .filter((name: string | undefined, index: number, names: Array<string | undefined>) =>
              name !== names[index - 1]
            ),
          workerDirectBusy: currentWorker?.busy,
          directFinishedNaturally: currentWorker?.messages.some((message: { text?: string }) =>
            message.text?.includes("reply to:")
          ),
        };
      }, { timeout: hostTimeout(10_000) }).toEqual({
        roomWorking: false,
        cards: 1,
        status: "completed",
        detail: "Specialist research incorporated after their direct task finished.",
        turnCount: 3,
        speakers: ["Worker coordinator", "Busy specialist", "Worker coordinator"],
        workerDirectBusy: false,
        directFinishedNaturally: true,
      });
    } finally {
      await api("POST", `/api/groups/${room.id}/interrupt`, {}).catch(() => undefined);
      await api("POST", `/api/bots/${lead.id}/interrupt`, {}).catch(() => undefined);
      await api("POST", `/api/bots/${worker.id}/interrupt`, {}).catch(() => undefined);
      await api("DELETE", `/api/groups/${room.id}`).catch(() => undefined);
      await api("DELETE", `/api/bots/${lead.id}`).catch(() => undefined);
      await api("DELETE", `/api/bots/${worker.id}`).catch(() => undefined);
    }
  });

  it("stops a waiting goal without interrupting unrelated direct work, and chat waits for busy bots the same way", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Occupied lead",
      modelSelection: { instanceId: "directHang", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Scoped stop team",
      memberIds: [lead.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    const chips = (messages: Array<{ kind: string; role?: string; tool?: { name?: string; ok?: boolean } }>) => ({
      waiting: messages.some((message) =>
        message.kind === "activity" &&
        /finishing another conversation — will reply here when free/i.test(message.tool?.name ?? "") &&
        message.tool?.ok === undefined
      ),
      skipped: messages.some((message) => /skipped this round/i.test(message.tool?.name ?? "")),
      replies: messages.filter((message) => message.kind === "text" && message.role === "bot").length,
    });

    try {
      expect((await api("POST", `/api/bots/${lead.id}/messages`, { text: "Keep this direct task running" })).status)
        .toBe(202);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=0")).body;
        return state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy;
      }).toBe(true);

      expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Ordinary room chat" })).status).toBe(202);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        return { working: current?.working, busyBotId: current?.busyBotId, ...chips(current?.messages ?? []) };
      }).toEqual({ working: true, busyBotId: null, waiting: true, skipped: false, replies: 0 });

      expect((await api("POST", `/api/groups/${room.id}/interrupt`, { threadId: room.threadId })).status).toBe(200);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        return {
          working: current?.working,
          directBusy: state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy,
          ...chips(current?.messages ?? []),
        };
      }).toEqual({ working: false, directBusy: true, waiting: true, skipped: false, replies: 0 });

      expect((await api("POST", `/api/groups/${room.id}/messages`, {
        text: "Wait and run this as a goal",
        mode: "goal",
      })).status).toBe(202);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        const card = current?.messages.find((message: { kind: string }) => message.kind === "goal.run");
        return {
          roomWorking: current?.working,
          roomBusyBotId: current?.busyBotId,
          status: card?.goalRun?.status,
          detail: card?.goalRun?.detail,
          turnCount: card?.goalRun?.turnCount,
        };
      }).toMatchObject({
        roomWorking: true,
        roomBusyBotId: null,
        status: "working",
        detail: expect.stringMatching(/finishing another conversation/i),
        turnCount: 0,
      });

      expect((await api("POST", `/api/groups/${room.id}/interrupt`, { threadId: room.threadId })).status).toBe(200);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        const cards = current?.messages.filter((message: { kind: string }) => message.kind === "goal.run") ?? [];
        return {
          roomWorking: current?.working,
          cards: cards.length,
          status: cards[0]?.goalRun?.status,
          turnCount: cards[0]?.goalRun?.turnCount,
          directBusy: state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy,
        };
      }).toEqual({
        roomWorking: false,
        cards: 1,
        status: "stopped",
        turnCount: 0,
        directBusy: true,
      });
    } finally {
      await api("POST", `/api/groups/${room.id}/interrupt`, {}).catch(() => undefined);
      await api("POST", `/api/bots/${lead.id}/interrupt`, {}).catch(() => undefined);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=0")).body;
        return state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy;
      }, { timeout: 5_000 }).toBe(false);
      await api("DELETE", `/api/groups/${room.id}`).catch(() => undefined);
      await api("DELETE", `/api/bots/${lead.id}`).catch(() => undefined);
    }
  });

  it("stops a detached scheduled goal from the active room and cancels its routine run", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Detached scheduled lead",
      modelSelection: { instanceId: "directHang", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Detached stop team",
      memberIds: [lead.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    const originalThreadId = room.threadId;

    try {
      const created = await api("POST", "/api/routines", {
        name: "Hanging scheduled goal",
        prompt: "Keep this scheduled team goal running",
        target: "room-goal",
        groupId: room.id,
        botId: lead.id,
        runOn: "maus",
        schedule: { type: "once", at: Date.now() + 60_000 },
        durationMinutes: 30,
      });
      expect(created.status).toBe(201);
      const started = await api("POST", `/api/routines/${created.body.routine.id}/run`);
      expect(started.status).toBe(201);
      const runId = started.body.run.id;

      let backgroundThreadId = "";
      await expect.poll(async () => {
        const calendar = (await api("GET", "/api/routines")).body;
        const running = calendar.runs.find((run: { id: string }) => run.id === runId);
        const state = (await api("GET", "/api/bots?messages=0")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        backgroundThreadId = running?.threadId ?? "";
        return {
          runStatus: running?.status,
          detached: Boolean(running?.threadId && running.threadId !== originalThreadId),
          activeThreadId: current?.threadId,
          hasBackgroundTask: current?.tasks.some(
            (task: { threadId: string }) => task.threadId === running?.threadId,
          ),
          roomWorking: current?.working,
          leadBusy: state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy,
        };
      }, { timeout: hostTimeout(10_000) }).toEqual({
        runStatus: "running",
        detached: true,
        activeThreadId: originalThreadId,
        hasBackgroundTask: true,
        roomWorking: true,
        leadBusy: true,
      });

      expect((await api("POST", `/api/groups/${room.id}/interrupt`)).status).toBe(200);

      await expect.poll(async () => {
        const calendar = (await api("GET", "/api/routines")).body;
        const stopped = calendar.runs.find((run: { id: string }) => run.id === runId);
        const state = (await api("GET", "/api/bots?messages=0")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        return {
          runStatus: stopped?.status,
          runThreadId: stopped?.threadId,
          activeThreadId: current?.threadId,
          roomWorking: current?.working,
          leadBusy: state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy,
        };
      }, { timeout: hostTimeout(10_000) }).toEqual({
        runStatus: "cancelled",
        runThreadId: backgroundThreadId,
        activeThreadId: originalThreadId,
        roomWorking: false,
        leadBusy: false,
      });

      const opened = await api("POST", `/api/groups/${room.id}/tasks/${backgroundThreadId}`);
      expect(opened.status).toBe(200);
      expect(opened.body.group.messages.filter((message: { kind: string }) => message.kind === "goal.run"))
        .toEqual([
          expect.objectContaining({
            goalRun: expect.objectContaining({ runId, status: "stopped", detail: "Stopped by you." }),
          }),
        ]);
    } finally {
      await api("POST", `/api/groups/${room.id}/interrupt`).catch(() => undefined);
      await api("POST", `/api/bots/${lead.id}/interrupt`).catch(() => undefined);
      await api("DELETE", `/api/groups/${room.id}`).catch(() => undefined);
      await api("DELETE", `/api/bots/${lead.id}`).catch(() => undefined);
    }
  });

  it("stops a detached scheduled goal from the coordinator's ordinary Stop", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Detached bot-stop lead",
      modelSelection: { instanceId: "directHang", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Detached bot-stop team",
      memberIds: [lead.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    const originalThreadId = room.threadId;

    try {
      const created = await api("POST", "/api/routines", {
        name: "Coordinator-stopped scheduled goal",
        prompt: "Keep this detached goal running until the coordinator is stopped",
        target: "room-goal",
        groupId: room.id,
        botId: lead.id,
        runOn: "maus",
        schedule: { type: "once", at: Date.now() + 60_000 },
        durationMinutes: 30,
      });
      expect(created.status).toBe(201);
      const started = await api("POST", `/api/routines/${created.body.routine.id}/run`);
      expect(started.status).toBe(201);
      const runId = started.body.run.id;

      let backgroundThreadId = "";
      await expect.poll(async () => {
        const calendar = (await api("GET", "/api/routines")).body;
        const running = calendar.runs.find((run: { id: string }) => run.id === runId);
        const state = (await api("GET", "/api/bots?messages=0")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        backgroundThreadId = running?.threadId ?? "";
        return {
          runStatus: running?.status,
          detached: Boolean(running?.threadId && running.threadId !== originalThreadId),
          activeThreadId: current?.threadId,
          roomWorking: current?.working,
          leadBusy: state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy,
        };
      }, { timeout: hostTimeout(10_000) }).toEqual({
        runStatus: "running",
        detached: true,
        activeThreadId: originalThreadId,
        roomWorking: true,
        leadBusy: true,
      });

      expect((await api("POST", `/api/bots/${lead.id}/interrupt`)).status).toBe(200);

      await expect.poll(async () => {
        const calendar = (await api("GET", "/api/routines")).body;
        const stopped = calendar.runs.find((run: { id: string }) => run.id === runId);
        const state = (await api("GET", "/api/bots?messages=0")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        return {
          runStatus: stopped?.status,
          runThreadId: stopped?.threadId,
          activeThreadId: current?.threadId,
          roomWorking: current?.working,
          leadBusy: state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy,
        };
      }, { timeout: hostTimeout(10_000) }).toEqual({
        runStatus: "cancelled",
        runThreadId: backgroundThreadId,
        activeThreadId: originalThreadId,
        roomWorking: false,
        leadBusy: false,
      });

      const opened = await api("POST", `/api/groups/${room.id}/tasks/${backgroundThreadId}`);
      expect(opened.status).toBe(200);
      expect(opened.body.group.messages.filter((message: { kind: string }) => message.kind === "goal.run"))
        .toEqual([
          expect.objectContaining({
            goalRun: expect.objectContaining({ runId, status: "stopped", detail: "Stopped by you." }),
          }),
        ]);
    } finally {
      await api("POST", `/api/groups/${room.id}/interrupt`).catch(() => undefined);
      await api("POST", `/api/bots/${lead.id}/interrupt`).catch(() => undefined);
      await api("DELETE", `/api/groups/${room.id}`).catch(() => undefined);
      await api("DELETE", `/api/bots/${lead.id}`).catch(() => undefined);
    }
  });

  it("stops the coordinator's direct turn without cancelling a routine goal waiting on its worker", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Stop-scoped coordinator",
      modelSelection: { instanceId: "stopScopedLead", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const worker = (await api("POST", "/api/bots", {
      name: "Delayed worker",
      modelSelection: { instanceId: "stopScopedWorker", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Coordinator stop scope team",
      memberIds: [lead.id, worker.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;

    try {
      expect((await api("POST", `/api/bots/${worker.id}/messages`, {
        text: "Finish this unrelated worker task first",
      })).status).toBe(202);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=0")).body;
        return state.bots.find((bot: { id: string }) => bot.id === worker.id)?.busy;
      }).toBe(true);

      const created = await api("POST", "/api/routines", {
        name: "Worker-gated scheduled goal",
        prompt: "Complete the scheduled analysis as a team",
        target: "room-goal",
        groupId: room.id,
        botId: lead.id,
        runOn: "maus",
        schedule: { type: "once", at: Date.now() + 60_000 },
        durationMinutes: 30,
      });
      expect(created.status).toBe(201);
      const started = await api("POST", `/api/routines/${created.body.routine.id}/run`);
      expect(started.status).toBe(201);
      const runId = started.body.run.id;

      let backgroundThreadId = "";
      await expect.poll(async () => {
        const calendar = (await api("GET", "/api/routines")).body;
        const running = calendar.runs.find((run: { id: string }) => run.id === runId);
        backgroundThreadId = running?.threadId ?? "";
        return { status: running?.status, threadId: running?.threadId };
      }, { timeout: hostTimeout(10_000) }).toMatchObject({ status: "running", threadId: expect.any(String) });

      const opened = await api("POST", `/api/groups/${room.id}/tasks/${backgroundThreadId}`);
      expect(opened.status).toBe(200);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        const card = current?.messages.find((message: { kind: string }) => message.kind === "goal.run");
        return {
          activeThreadId: current?.threadId,
          roomWorking: current?.working,
          status: card?.goalRun?.status,
          detail: card?.goalRun?.detail,
          turnCount: card?.goalRun?.turnCount,
          leadBusy: state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy,
          workerBusy: state.bots.find((bot: { id: string }) => bot.id === worker.id)?.busy,
        };
      }, { timeout: hostTimeout(10_000) }).toMatchObject({
        activeThreadId: backgroundThreadId,
        roomWorking: true,
        status: "working",
        detail: expect.stringMatching(/Delayed worker is finishing another conversation/i),
        turnCount: 1,
        leadBusy: false,
        workerBusy: true,
      });

      // Hold just this unrelated direct turn until Stop is observed.
      rmSync(stopScopedLeadFinishGate, { force: true });
      expect((await api("POST", `/api/bots/${lead.id}/messages`, {
        text: "Start unrelated coordinator work",
      })).status).toBe(202);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const currentLead = state.bots.find((bot: { id: string }) => bot.id === lead.id);
        return {
          busy: currentLead?.busy,
          directReplyStarted: currentLead?.messages.some((message: { text?: string }) =>
            message.text?.includes("This is unrelated direct work and should be stopped.")
          ),
        };
      }).toEqual({ busy: true, directReplyStarted: true });

      expect((await api("POST", `/api/bots/${lead.id}/interrupt`)).status).toBe(200);
      await expect.poll(async () => {
        const state = (await api("GET", "/api/bots?messages=30")).body;
        return state.bots.find((bot: { id: string }) => bot.id === lead.id)?.busy;
      }, { timeout: 5_000 }).toBe(false);

      writeFileSync(stopScopedLeadFinishGate, "allow the later goal continuation");
      // The worker may settle and advance the room while Stop is in flight: only cancellation is wrong.
      const afterStopCalendar = (await api("GET", "/api/routines")).body;
      const afterStopRun = afterStopCalendar.runs.find((run: { id: string }) => run.id === runId);
      const afterStopState = (await api("GET", "/api/bots?messages=30")).body;
      const afterStopRoom = afterStopState.groups.find((group: { id: string }) => group.id === room.id);
      const afterStopCard = afterStopRoom.messages.find((message: { kind: string }) => message.kind === "goal.run");
      expect(["running", "completed"]).toContain(afterStopRun.status);
      expect(["working", "completed"]).toContain(afterStopCard.goalRun.status);
      expect(afterStopCard.goalRun.status).not.toBe("stopped");

      writeFileSync(stopScopedWorkerFinishGate, "finish");
      await expect.poll(async () => {
        const calendar = (await api("GET", "/api/routines")).body;
        const completed = calendar.runs.find((run: { id: string }) => run.id === runId);
        const state = (await api("GET", "/api/bots?messages=30")).body;
        const current = state.groups.find((group: { id: string }) => group.id === room.id);
        const cards = current?.messages.filter((message: { kind: string }) => message.kind === "goal.run") ?? [];
        return {
          runStatus: completed?.status,
          output: completed?.output,
          roomWorking: current?.working,
          cards: cards.length,
          goalStatus: cards[0]?.goalRun?.status,
          detail: cards[0]?.goalRun?.detail,
          turnCount: cards[0]?.goalRun?.turnCount,
        };
      }, { timeout: 15_000 }).toEqual({
        runStatus: "completed",
        output: "Scheduled goal survived the coordinator's direct Stop.",
        roomWorking: false,
        cards: 1,
        goalStatus: "completed",
        detail: "Scheduled goal survived the coordinator's direct Stop.",
        turnCount: 3,
      });
    } finally {
      writeFileSync(stopScopedWorkerFinishGate, "finish");
      await api("POST", `/api/groups/${room.id}/interrupt`).catch(() => undefined);
      await api("POST", `/api/bots/${lead.id}/interrupt`).catch(() => undefined);
      await api("POST", `/api/bots/${worker.id}/interrupt`).catch(() => undefined);
      await api("DELETE", `/api/groups/${room.id}`).catch(() => undefined);
      await api("DELETE", `/api/bots/${lead.id}`).catch(() => undefined);
      await api("DELETE", `/api/bots/${worker.id}`).catch(() => undefined);
    }
  });

  it("runs a routine as a goal in a new background room task", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Scheduled lead",
      modelSelection: { instanceId: "routineGoal", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Scheduled review team",
      memberIds: [lead.id],
      setup: { bulletin: "Review carefully.", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    const originalThreadId = room.threadId;

    try {
      const created = await api("POST", "/api/routines", {
        name: "Daily team review",
        prompt: "Review the release as a team",
        target: "room-goal",
        groupId: room.id,
        botId: lead.id,
        runOn: "maus",
        schedule: { type: "once", at: Date.now() + 60_000 },
        durationMinutes: 30,
      });
      expect(created.status).toBe(201);
      expect(created.body.routine).toMatchObject({
        target: "room-goal",
        groupId: room.id,
        botId: lead.id,
      });

      const started = await api("POST", `/api/routines/${created.body.routine.id}/run`);
      expect(started.status).toBe(201);
      const runId = started.body.run.id;

      await expect.poll(async () => {
        const calendar = (await api("GET", "/api/routines")).body;
        const running = calendar.runs.find((run: { id: string }) => run.id === runId);
        const state = (await api("GET", "/api/bots?messages=0")).body;
        const backgroundRoom = state.groups.find((group: { id: string }) => group.id === room.id);
        return {
          status: running?.status,
          threadId: running?.threadId,
          activeThreadId: backgroundRoom?.threadId,
          hasTask: backgroundRoom?.tasks.some(
            (task: { threadId: string }) => task.threadId === running?.threadId,
          ),
          working: backgroundRoom?.working,
        };
      }).toMatchObject({
        status: "running",
        threadId: expect.any(String),
        activeThreadId: originalThreadId,
        hasTask: true,
        working: true,
      });

      const runningCalendar = (await api("GET", "/api/routines")).body;
      const running = runningCalendar.runs.find((run: { id: string }) => run.id === runId);
      const openedWhileWorking = await api("POST", `/api/groups/${room.id}/tasks/${running.threadId}`);
      expect(openedWhileWorking.status).toBe(200);
      expect(openedWhileWorking.body.group).toMatchObject({
        threadId: running.threadId,
        working: true,
      });
      writeFileSync(routineGoalFinishGate, "opened the running background task");

      await expect.poll(async () => {
        const calendar = (await api("GET", "/api/routines")).body;
        return calendar.runs.find((run: { id: string }) => run.id === runId);
      }, { timeout: hostTimeout(10_000) }).toMatchObject({
        id: runId,
        status: "completed",
        target: "room-goal",
        groupId: room.id,
        botId: lead.id,
        output: "Scheduled team review completed.",
        threadId: expect.any(String),
      });

      const calendar = (await api("GET", "/api/routines")).body;
      const completedRun = calendar.runs.find((run: { id: string }) => run.id === runId);
      const state = (await api("GET", "/api/bots?messages=0")).body;
      const backgroundRoom = state.groups.find((group: { id: string }) => group.id === room.id);
      expect(backgroundRoom.threadId).toBe(completedRun.threadId);
      expect(backgroundRoom.tasks).toContainEqual(expect.objectContaining({
        threadId: completedRun.threadId,
        title: expect.stringMatching(/^Daily team review · [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/),
      }));

      const switched = await api("POST", `/api/groups/${room.id}/tasks/${completedRun.threadId}`);
      expect(switched.status).toBe(200);
      expect(switched.body.group.messages.filter((message: { kind: string }) => message.kind === "goal.run"))
        .toEqual([
          expect.objectContaining({
            goalRun: expect.objectContaining({
              runId,
              status: "completed",
              coordinatorBotId: lead.id,
              detail: "Scheduled team review completed.",
            }),
          }),
        ]);
    } finally {
      await api("POST", `/api/groups/${room.id}/interrupt`, {}).catch(() => undefined);
      await api("POST", `/api/bots/${lead.id}/interrupt`, {}).catch(() => undefined);
      await api("DELETE", `/api/groups/${room.id}`).catch(() => undefined);
      await api("DELETE", `/api/bots/${lead.id}`).catch(() => undefined);
    }
  });

  it("pauses a non-converging team at the hard turn limit", async () => {
    const looper = (await api("POST", "/api/bots", {
      name: "Looper",
      modelSelection: { instanceId: "loop", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Bounded team",
      memberIds: [looper.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: looper.id } },
    })).body.group;
    const started = await api("POST", `/api/groups/${room.id}/messages`, {
      text: "Keep trying forever",
      mode: "goal",
    });
    expect(started.status).toBe(202);
    // Per-turn digests can push the card out of a tail page, so read around the accepted message.
    const initial = await api("GET", `/api/threads/${started.body.threadId}/messages?around=${started.body.message.id}&limit=3`);
    const card = initial.body.messages.find((message: { kind: string }) => message.kind === "goal.run");
    expect(card).toMatchObject({ id: expect.any(String) });

    await expect.poll(async () => {
      const page = await api("GET", `/api/threads/${started.body.threadId}/messages?around=${card.id}&limit=1`);
      return page.body.messages[0]?.goalRun;
    }, { timeout: 15_000 }).toMatchObject({ status: "limit-reached", turnCount: 13, maxTurns: 13 });
  });

  it("never treats a failed provider turn as a completed goal", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Failing lead",
      modelSelection: { instanceId: "crash", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Failure checks",
      memberIds: [lead.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;

    expect((await api("POST", `/api/groups/${room.id}/messages`, {
      text: "Do not claim this succeeded",
      mode: "goal",
    })).status).toBe(202);

    await expect.poll(async () => {
      const state = (await api("GET", "/api/bots?messages=20")).body;
      const current = state.groups.find((candidate: { id: string }) => candidate.id === room.id);
      return current?.messages.find((message: { kind: string }) => message.kind === "goal.run")?.goalRun;
      // the failed attempt is retried once, and a retry costs a turn, so the count is two
    }, { timeout: hostTimeout(10_000) }).toMatchObject({ status: "failed", turnCount: 2 });
  });

  it("validates mode and binds it to the send id", async () => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Mode checks",
      memberIds: [bot.id],
      setup: { bulletin: "", defaultResponder: { kind: "mentions" } },
    })).body.group;
    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "hello", mode: "forever" })).status).toBe(400);
    const body = { text: "quiet note", mode: "chat", sendId: "mode_send_1234567890" };
    expect((await api("POST", `/api/groups/${room.id}/messages`, body)).status).toBe(202);
    expect((await api("POST", `/api/groups/${room.id}/messages`, { ...body, mode: "goal" })).status).toBe(409);

    const dm = (await api("GET", "/api/bots?messages=0")).body.groups.find((group: { dm?: boolean }) => group.dm);
    if (dm) expect((await api("POST", `/api/groups/${dm.id}/messages`, { text: "goal", mode: "goal" })).status).toBe(400);
  });

  it("automatically dispatches channel messages queued during a running turn", async () => {
    const bot = (await api("POST", "/api/bots", {
      name: "Queue worker",
      modelSelection: { instanceId: "slow", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Queue checks",
      memberIds: [bot.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } },
    })).body.group;
    const firstSendId = "channel_queue_first_1234";
    const secondSendId = "channel_queue_second_123";

    const first = await api("POST", `/api/groups/${room.id}/messages`, {
      text: "first request",
      sendId: firstSendId,
    });
    expect(first.status).toBe(202);
    expect(first.body.message).toMatchObject({ role: "user", text: "first request", sendId: firstSendId });

    await expect.poll(async () => {
      const state = (await api("GET", "/api/bots?messages=0")).body;
      return state.groups.find((candidate: { id: string }) => candidate.id === room.id)?.working;
    }).toBe(true);

    const queuedBody = { text: "second request", sendId: secondSendId };
    const queued = await api("POST", `/api/groups/${room.id}/messages`, queuedBody);
    expect(queued.status).toBe(202);
    expect(queued.body).toMatchObject({ queued: true, threadId: room.threadId });
    expect(queued.body.queueId).toEqual(expect.any(String));
    expect(queued.body.message).toBeUndefined();

    const retryWhileQueued = await api("POST", `/api/groups/${room.id}/messages`, queuedBody);
    expect(retryWhileQueued.body).toMatchObject({ queued: true, queueId: queued.body.queueId });
    writeFileSync(queueFinishGate, "observed the queued message and idempotent retry");

    await expect.poll(async () => {
      const state = (await api("GET", "/api/bots?messages=30")).body;
      const current = state.groups.find((candidate: { id: string }) => candidate.id === room.id);
      const userLines = current?.messages.filter((message: { role?: string }) => message.role === "user") ?? [];
      return {
        working: current?.working,
        sends: userLines.map((message: { sendId?: string }) => message.sendId),
      };
    }, { timeout: hostTimeout(10_000) }).toEqual({ working: false, sends: [firstSendId, secondSendId] });

    const state = (await api("GET", "/api/bots?messages=30")).body;
    const current = state.groups.find((candidate: { id: string }) => candidate.id === room.id);
    const firstUserAt = current.messages.findIndex((message: { sendId?: string }) => message.sendId === firstSendId);
    const secondUserAt = current.messages.findIndex((message: { sendId?: string }) => message.sendId === secondSendId);
    const firstReplyAt = current.messages.findIndex(
      (message: { role?: string }, index: number) => index > firstUserAt && message.role === "bot",
    );
    const secondReplyAt = current.messages.findIndex(
      (message: { role?: string }, index: number) => index > secondUserAt && message.role === "bot",
    );
    expect(firstUserAt).toBeGreaterThanOrEqual(0);
    expect(firstReplyAt).toBeGreaterThan(firstUserAt);
    expect(secondUserAt).toBeGreaterThan(firstReplyAt);
    expect(secondReplyAt).toBeGreaterThan(secondUserAt);
    expect(current.messages[secondUserAt]).toMatchObject({ queueId: queued.body.queueId });

    const retryAfterDrain = await api("POST", `/api/groups/${room.id}/messages`, queuedBody);
    expect(retryAfterDrain.body.message).toMatchObject({
      sendId: secondSendId,
      queueId: queued.body.queueId,
    });
  });

  it("runs a task plan as parallel worker turns on one coordinator turn", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Wave lead",
      modelSelection: { instanceId: "waveLead", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const held = (await api("POST", "/api/bots", {
      name: "Held worker",
      modelSelection: { instanceId: "waveHeld", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const free = (await api("POST", "/api/bots", {
      name: "Free worker",
      modelSelection: { instanceId: "waveFree", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Wave team",
      memberIds: [lead.id, held.id, free.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;

    const sent = await api("POST", `/api/groups/${room.id}/messages`, {
      text: "Plan and de-risk the launch together",
      mode: "goal",
      sendId: "goal_send_wave_1234567890",
    });
    expect(sent.status).toBe(202);
    expect(sent.body.message).toMatchObject({ channelMode: "goal" });

    // Both plan tasks were dispatched from the same coordinator turn: the free worker's
    // result row lands while the held worker is still waiting on its gate.
    const resultRows = (current: { messages?: Array<{ kind: string; from?: { name?: string }; roomRequest?: { phase?: string } }> }) =>
      current?.messages?.filter((message) => message.kind === "activity" && message.roomRequest?.phase === "result")
        .map((message) => message.from?.name) ?? [];
    await expect.poll(async () => {
      const state = (await api("GET", "/api/bots?messages=30")).body;
      const current = state.groups.find((candidate: { id: string }) => candidate.id === room.id);
      const rows = resultRows(current);
      return rows.includes("Free worker") && !rows.includes("Held worker") ? true : `result rows so far: ${JSON.stringify(rows)}`;
    }, { timeout: hostTimeout(15_000) }).toBe(true);

    writeFileSync(waveHeldFinishGate, "release the held plan worker");

    await expect.poll(async () => {
      const state = (await api("GET", "/api/bots?messages=30")).body;
      const current = state.groups.find((candidate: { id: string }) => candidate.id === room.id);
      return current?.messages.find((message: { kind: string }) => message.kind === "goal.run")?.goalRun;
    }, { timeout: hostTimeout(15_000) }).toMatchObject({
      status: "completed",
      coordinatorBotId: lead.id,
      turnCount: 3,
      detail: "Plan drafted and risks listed.",
    });

    const state = (await api("GET", "/api/bots?messages=30")).body;
    const current = state.groups.find((candidate: { id: string }) => candidate.id === room.id);
    expect(current.messages.filter((message: { kind: string; role?: string }) => message.kind === "text" && message.role === "bot")
      .map((message: { from?: { name?: string } }) => message.from?.name)).toEqual(["Wave lead", "Wave lead"]);
    const rows = current.messages.filter((message: { kind: string; roomRequest?: { phase?: string }; tool?: { ok?: boolean } }) => message.kind === "activity" && message.roomRequest?.phase === "result");
    expect(rows.map((message: { from?: { name?: string } }) => message.from?.name)).toEqual(["Free worker", "Held worker"]);
    expect(rows.every((message: { tool?: { ok?: boolean } }) => message.tool?.ok === true)).toBe(true);
    expect(JSON.stringify(current.messages)).not.toContain("<openmaus-goal>");
    expect(JSON.stringify(current.messages)).not.toContain("\"tasks\":");
    expect(current.working).toBe(false);
  });

  it("answers a teammate named mid-goal in a lane of its own while the goal keeps running", async () => {
    const lead = (await api("POST", "/api/bots", {
      name: "Side lead",
      modelSelection: { instanceId: "sideLead", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const held = (await api("POST", "/api/bots", {
      name: "Side held",
      modelSelection: { instanceId: "sideHeld", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const free = (await api("POST", "/api/bots", {
      name: "Side free",
      modelSelection: { instanceId: "sideFree", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Side team",
      memberIds: [lead.id, held.id, free.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    const roomState = async () => (await api("GET", "/api/bots?messages=40")).body.groups.find((candidate: { id: string }) => candidate.id === room.id);
    const goalStatus = async () => (await roomState())?.messages.find((message: { kind: string }) => message.kind === "goal.run")?.goalRun?.status;

    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Plan the launch", mode: "goal", sendId: "goal_send_side_1234567890" })).status).toBe(202);
    await expect.poll(async () => (await roomState())?.messages.some((message: { kind: string }) => message.kind === "goal.run"), { timeout: hostTimeout(15_000) }).toBe(true);
    await expect.poll(async () => (await roomState())?.working, { timeout: hostTimeout(15_000) }).toBe(true);

    await expect.poll(async () => (await api("GET", `/api/groups/${room.id}/now`)).body.members
      .find((row: { botId: string }) => row.botId === held.id), { timeout: hostTimeout(15_000) })
      .toMatchObject({ state: "running", task: expect.stringContaining("Draft and report") });
    expect((await api("GET", `/api/groups/${room.id}/now?threadId=not-a-thread`)).status).toBe(404);
    const asked = await api("POST", `/api/groups/${room.id}/messages`, { text: "@Side free how is it going?", sendId: "chat_send_side_1234567890" });
    expect(asked.status).toBe(202);
    expect(asked.body.queued).not.toBe(true);
    expect(asked.body.message).toMatchObject({ role: "user" });
    await expect.poll(async () => (await roomState())?.messages.filter((message: { kind: string; from?: { name?: string }; roomRequest?: { phase?: string } }) =>
      message.kind === "activity" && message.roomRequest?.phase === "result" && message.from?.name === "Side free").length, { timeout: hostTimeout(15_000) }).toBe(1);
    expect(await goalStatus()).toBe("working");

    const askedLead = await api("POST", `/api/groups/${room.id}/messages`, { text: "@Side lead status please?", sendId: "chat_send_side_lead_1234567" });
    expect(askedLead.status).toBe(202);
    expect(askedLead.body.queued).not.toBe(true);
    const failures = (await roomState())?.messages.filter((message: { tool?: { name?: string; ok?: boolean } }) => message.tool?.ok === false && /could not take this message/.test(message.tool?.name ?? ""));
    expect(failures).toEqual([]);

    writeFileSync(sideHeldFinishGate, "release the held plan worker");
    await expect.poll(goalStatus, { timeout: hostTimeout(15_000) }).toBe("completed");
  });

  it("answers a teammate named in ordinary chat beside a running turn without stopping it", async () => {
    const slow = (await api("POST", "/api/bots", { name: "Chat slow", modelSelection: { instanceId: "chatSlow", model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;
    const free = (await api("POST", "/api/bots", { name: "Chat free", modelSelection: { instanceId: "chatFree", model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;
    const anchor = (await api("POST", "/api/bots", { name: "Chat anchor", modelSelection: { instanceId: "chatFree", model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;
    const room = (await api("POST", "/api/groups", {
      name: "Chat team",
      memberIds: [slow.id, free.id, anchor.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: slow.id } },
    })).body.group;
    const roomState = async () => (await api("GET", "/api/bots?messages=40")).body.groups.find((candidate: { id: string }) => candidate.id === room.id);

    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "@Chat slow build the thing", sendId: "chat_send_slow_123456789012" })).status).toBe(202);
    await expect.poll(async () => (await roomState())?.working, { timeout: hostTimeout(15_000) }).toBe(true);

    const asked = await api("POST", `/api/groups/${room.id}/messages`, { text: "@Chat free how is it going?", sendId: "chat_send_free_123456789012" });
    expect(asked.status).toBe(202);
    expect(asked.body.queued).not.toBe(true);
    await expect.poll(async () => (await roomState())?.messages.some((message: { kind: string; from?: { name?: string }; roomRequest?: { phase?: string }; tool?: { ok?: boolean } }) =>
      message.kind === "activity" && message.roomRequest?.phase === "result" && message.from?.name === "Chat free" && message.tool?.ok === true), { timeout: hostTimeout(15_000) }).toBe(true);
    expect((await roomState())?.working).toBe(true);

    const turnsBefore = readFileSync(join(home, "chat-free-replies.txt"), "utf8");
    const progress = await api("POST", `/api/groups/${room.id}/messages`, { text: "tình hình sao rồi", sendId: "chat_send_progress_12345678" });
    expect(progress.status).toBe(202);
    expect(progress.body.queued).not.toBe(true);
    const progressRow = (await roomState())?.messages.at(-1);
    expect(progressRow).toMatchObject({ kind: "activity", tool: { ok: true } });
    expect(progressRow.tool.name).toContain("Chat slow");
    expect(progressRow.tool.name).toContain("build the thing");
    expect(readFileSync(join(home, "chat-free-replies.txt"), "utf8")).toBe(turnsBefore);

    writeFileSync(chatSlowFinishGate, "release the slow turn");
    await expect.poll(async () => (await roomState())?.messages.some((message: { kind: string; role: string; text?: string }) =>
      message.kind === "text" && message.role === "bot" && message.text === "Slow work finished."), { timeout: hostTimeout(15_000) }).toBe(true);
    const stopped = (await roomState())?.messages.filter((message: { tool?: { name?: string } }) => /Stopped|cancel/i.test(message.tool?.name ?? ""));
    expect(stopped).toEqual([]);
  });

  it("lets a room turn parallel goal waves off and on again", async () => {
    const ids = [] as string[];
    for (const name of ["Wave toggle A", "Wave toggle B", "Wave toggle C"]) {
      ids.push((await api("POST", "/api/bots", { name, modelSelection: { instanceId: "chatFree", model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot.id);
    }
    const room = (await api("POST", "/api/groups", { name: "Wave toggle", memberIds: ids, setup: { bulletin: "", defaultResponder: { kind: "member", botId: ids[0] } } })).body.group;
    expect(room.goalWaves).toBeUndefined();
    expect((await api("PATCH", `/api/groups/${room.id}`, { goalWaves: false })).body.group.goalWaves).toBe(false);
    expect((await api("PATCH", `/api/groups/${room.id}`, { goalWaves: "no" })).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${room.id}`, { goalWaves: true })).body.group.goalWaves).toBeUndefined();
  });

  it("runs a goal with standing roles: the Lead plans, the Worker builds, an added Tester passes it, then it completes", async () => {
    const make = async (name: string, instanceId: string) => (await api("POST", "/api/bots", { name, modelSelection: { instanceId, model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;
    const lead = await make("Role lead", "roleLead");
    const builder = await make("Role builder", "roleWorker");
    const checker = await make("Role checker", "roleTester");
    const room = (await api("POST", "/api/groups", {
      name: "Role team", memberIds: [lead.id, builder.id, checker.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: builder.id } },
    })).body.group;
    expect((await api("PATCH", `/api/groups/${room.id}`, { roles: { [lead.id]: "lead", [builder.id]: "lead" } })).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${room.id}`, { roles: { "not-a-member": "worker" } })).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${room.id}`, { roles: { [lead.id]: "boss" } })).status).toBe(400);
    const roles = { [lead.id]: "lead", [builder.id]: "worker", [checker.id]: "tester" };
    expect((await api("PATCH", `/api/groups/${room.id}`, { roles })).body.group.roles).toEqual(roles);

    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Add the page", mode: "goal", sendId: "goal_send_roles_1234567890" })).status).toBe(202);
    const roomState = async () => (await api("GET", "/api/bots?messages=40")).body.groups.find((candidate: { id: string }) => candidate.id === room.id);
    await expect.poll(async () => (await roomState())?.messages.find((message: { kind: string }) => message.kind === "goal.run")?.goalRun, { timeout: hostTimeout(20_000) })
      .toMatchObject({ status: "completed", coordinatorBotId: lead.id, detail: "Page added and tested." });
    const results = (await roomState()).messages
      .filter((message: { kind: string; roomRequest?: { phase?: string } }) => message.kind === "activity" && message.roomRequest?.phase === "result")
      .map((message: { from?: { name?: string } }) => message.from?.name);
    expect(results).toEqual(["Role builder", "Role checker"]);
  });

  it("runs a work request as a goal in a room with a Lead, and /chat or a question as chat", async () => {
    const make = async (name: string) => (await api("POST", "/api/bots", { name, modelSelection: { instanceId: "autoLead", model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;
    const lead = await make("Auto lead");
    const other = await make("Auto other");
    const room = (await api("POST", "/api/groups", {
      name: "Auto team", memberIds: [lead.id, other.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    const send = (text: string, sendId: string, extra: Record<string, unknown> = {}) => api("POST", `/api/groups/${room.id}/messages`, { text, sendId, ...extra });
    const idle = () => expect.poll(async () => (await api("GET", "/api/bots?messages=40")).body.groups.find((g: { id: string }) => g.id === room.id)?.working, { timeout: hostTimeout(15_000) }).toBe(false);

    expect((await send("làm trang chủ cho web", "auto_send_off_1234567890")).body.message).toMatchObject({ channelMode: "chat" });
    await idle();
    await api("PATCH", `/api/groups/${room.id}`, { roles: { [lead.id]: "lead", [other.id]: "worker" } });
    expect((await send("làm trang chủ cho web", "auto_send_on_12345678901")).body.message).toMatchObject({ channelMode: "goal" });
    await expect.poll(async () => (await api("GET", "/api/bots?messages=40")).body.groups.find((g: { id: string }) => g.id === room.id)
      ?.messages.find((m: { kind: string }) => m.kind === "goal.run")?.goalRun?.status, { timeout: hostTimeout(15_000) }).toBe("completed");
    await idle();
    expect((await send("làm trang chủ cho web", "auto_send_chat_123456789", { forceChat: true })).body.message).toMatchObject({ channelMode: "chat" });
    await idle();
    expect((await send("tình hình sao rồi", "auto_send_ask_1234567890")).body.message).toMatchObject({ channelMode: "chat" });
    await idle();
    await api("PATCH", `/api/groups/${room.id}`, { autoGoal: false });
    expect((await send("làm trang chủ cho web", "auto_send_sw_12345678901")).body.message).toMatchObject({ channelMode: "chat" });
  });

  it("gives the task of a Worker whose AI runs out of usage to another Worker and finishes the goal", async () => {
    const make = async (name: string, instanceId: string) => (await api("POST", "/api/bots", { name, modelSelection: { instanceId, model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;
    const lead = await make("Limit lead", "limitLead");
    const maple = await make("Limit maple", "limitOut");
    const clover = await make("Limit clover", "limitIn");
    const checker = await make("Limit checker", "limitIn");
    const room = (await api("POST", "/api/groups", {
      name: "Limit team", memberIds: [lead.id, maple.id, clover.id, checker.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    })).body.group;
    await api("PATCH", `/api/groups/${room.id}`, { roles: { [lead.id]: "lead", [maple.id]: "worker", [clover.id]: "worker", [checker.id]: "tester" } });
    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Build the UI", mode: "goal", sendId: "goal_send_limit_123456789" })).status).toBe(202);
    const roomState = async () => (await api("GET", "/api/bots?messages=60")).body.groups.find((g: { id: string }) => g.id === room.id);
    await expect.poll(async () => (await roomState())?.messages.find((m: { kind: string }) => m.kind === "goal.run")?.goalRun, { timeout: hostTimeout(25_000) })
      .toMatchObject({ status: "completed", detail: "UI built by Clover." });
    const notes = (await roomState()).messages.map((m: { tool?: { name?: string } }) => m.tool?.name ?? "");
    expect(notes).toContain("Limit maple ran out of AI usage — Limit clover takes its work");
  });
});
