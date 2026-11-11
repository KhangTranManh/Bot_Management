import { execFile, spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { WireBot, WireGroup, WireMessage } from "../shared/wire.ts";
import { whichWin } from "./env-path.ts";
import { waitForExit } from "./testing/cleanup.ts";

const git = (cwd: string, ...args: string[]) => new Promise<string>((resolve, reject) => execFile("git", args, { cwd, encoding: "utf8", windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
const envelope = (value: unknown) => `<openmaus-goal>${JSON.stringify(value)}</openmaus-goal>`;

it("runs isolated Workers, verifies integration, repairs conflicts, restores retained branches and applies only explicit decisions", async () => {
  const gitBinary = whichWin("git");
  expect(gitBinary).toBeTruthy();
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true, gitBinary: gitBinary! });
  const { url, dataDir } = fixture.info;
  let restarted: ChildProcess | undefined;
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const api = async <T = any>(method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = { status: response.status, body: await response.json() as T };
    evidence.push({ method, path, body, result });
    return result;
  };
  const planPath = join(dataDir, "room-plan.json");
  const plans: Record<string, unknown> = {};
  const messages = async (room: WireGroup) => (await api<{ messages: WireMessage[] }>("GET", `/api/threads/${room.threadId}/messages`)).body.messages;
  const card = async (room: WireGroup) => (await messages(room)).filter((message) => message.goalRun).at(-1)!;
  const make = async (name: string, conflict = false, options: { dirty?: boolean; failRepair?: boolean; stopAtTester?: boolean; testerFail?: boolean } = {}) => {
    const repo = join(dataDir, name);
    mkdirSync(repo);
    await git(repo, "init", "--quiet");
    await git(repo, "config", "user.name", "Fixture"); await git(repo, "config", "user.email", "fixture@localhost"); await git(repo, "config", "core.autocrlf", "false");
    writeFileSync(join(repo, "a.txt"), "original a\n"); writeFileSync(join(repo, "b.txt"), "original b\n");
    writeFileSync(join(repo, ".gitignore"), "verify.log\n.env.local\n");
    writeFileSync(join(repo, ".env.local"), "FIXTURE_ONLY=yes\n");
    writeFileSync(join(repo, "check.cjs"), `const fs = require('node:fs'); const assert = require('node:assert/strict'); fs.appendFileSync('verify.log', process.cwd()+'\\n'); assert.equal(fs.readFileSync('a.txt','utf8'), ${JSON.stringify(conflict ? "combined a and b\n" : options.testerFail ? "worker a fixed\n" : "worker a\n")}); ${conflict ? "" : "assert.equal(fs.readFileSync('b.txt','utf8'), 'worker b\\n');"} console.log('fixture checks pass');`);
    await git(repo, "add", "."); await git(repo, "-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "fixture");
    const head = await git(repo, "rev-parse", "HEAD");
    const index = readFileSync(join(repo, ".git", "index"));
    const bots: WireBot[] = [];
    for (const role of ["lead", "a", "b", "tester", "reviewer"]) bots.push((await api<{ bot: WireBot }>("POST", "/api/bots", { name: `${name}-${role}` })).body.bot);
    const [lead, a, b, tester, reviewer] = bots as [WireBot, WireBot, WireBot, WireBot, WireBot];
    const room = (await api<{ group: WireGroup }>("POST", "/api/groups", { name, memberIds: bots.map((bot) => bot.id), setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } } })).body.group;
    expect((await api("PATCH", `/api/groups/${room.id}`, { cwd: repo, kind: "code", isolatedBranches: true, branchFiles: [".env.local"], roles: { [lead.id]: "lead", [a.id]: "worker", [b.id]: "worker", [tester.id]: "tester", [reviewer.id]: "reviewer" }, verify: [{ id: "checks", command: "node check.cjs" }] })).status).toBe(200);
    const finish = join(dataDir, `${name}-finish`), readyA = join(dataDir, `${name}-a-ready`), readyB = join(dataDir, `${name}-b-ready`);
    const goal = `Build ${name}`;
    plans[lead.id] = { turns: [{ reply: envelope({ status: "continue", brief: { goal, acceptance: ["checks pass"] }, tasks: [{ id: "a", assignee: a.id, instruction: "Implement a", writes: ["a.txt"] }, { id: "b", assignee: b.id, instruction: "Implement b", writes: options.testerFail ? ["a.txt", "b.txt"] : [conflict ? "a.txt" : "b.txt"] }] }) }, { reply: envelope({ status: "completed", detail: "Integrated and checked" }) }] };
    plans[a.id] = { writeFiles: { "a.txt": "worker a\n" }, readyFile: readyA, gateFile: finish, reply: "Built a." };
    if (options.testerFail) {
      plans[a.id] = { ...plans[a.id] as object, byPrompt: [{ promptIncludes: "Fix a after test", plan: { writeFiles: { "a.txt": "worker a fixed\n" }, reply: "Fixed a." } }] };
      plans[lead.id] = { turns: [(plans[lead.id] as any).turns[0], { expectContextIncludes: [`a.txt → ${a.name} (task a)`], reply: envelope({ status: "continue", tasks: [{ id: "fix-a", assignee: a.id, instruction: "Fix a after test", writes: ["a.txt"] }] }) }, { reply: envelope({ status: "completed", detail: "Repaired and checked" }) }] };
    }
    plans[b.id] = { byPrompt: [{ promptIncludes: "Resolve the merge conflict", plan: { writeFiles: options.failRepair ? { "b.txt": "unrelated repair\n" } : { "a.txt": "combined a and b\n" }, reply: "Repaired." } }], writeFiles: { [conflict ? "a.txt" : "b.txt"]: "worker b\n" }, readyFile: readyB, gateFile: finish, reply: "Built b." };
    plans[tester.id] = { reply: "VERDICT: PASS", expectContextIncludes: ["Check the integrated working folder"] };
    if (options.stopAtTester) plans[tester.id] = { reply: "VERDICT: PASS", readyFile: join(dataDir, `${name}-tester-ready`), gateFile: join(dataDir, `${name}-tester-finish`) };
    if (options.testerFail) plans[tester.id] = { turns: [{ reply: "FAIL: a.txt — fixture error\nVERDICT: FAIL" }, { reply: "VERDICT: PASS" }] };
    plans[reviewer.id] = { reply: "REVIEW: CLEAR", expectContextIncludes: ["server-produced diffs for each task"] };
    writeFileSync(planPath, JSON.stringify(plans));
    if (options.dirty) writeFileSync(join(repo, "dirty.txt"), "human change\n");
    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: goal, mode: "goal" })).status).toBe(202);
    return { repo, head, index, room, bots, goal, finish, readyA, readyB };
  };
  const decide = async (room: WireGroup, action: "merge" | "keep" | "discard", confirm = true) => {
    const message = await card(room);
    return api("POST", `/api/groups/${room.id}/tasks/${room.threadId}/goals/${message.id}/branches`, { action, head: message.goalRun!.branches!.head, ...(confirm ? { confirm: true } : {}) });
  };
  const restart = async () => {
    await waitForExit(restarted ?? fixture.child, { signal: "SIGTERM" });
    const log = openSync(fixture.info.logPath, "a", 0o600);
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], { cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...verificationServerEnvironment(process.env, dataDir, Number(new URL(url).port)), OMB_EXTRA_PATH: dirname(gitBinary!) }, stdio: ["ignore", log, log], windowsHide: true });
    closeSync(log);
    await expect.poll(async () => { try { return (await api("GET", "/api/health")).body.pid; } catch { return 0; } }, { timeout: 20_000 }).toBe(restarted!.pid);
  };
  const awaitWorkers = async (work: Awaited<ReturnType<typeof make>>) => {
    await expect.poll(() => existsSync(work.readyA) && existsSync(work.readyB), { timeout: 25_000 }).toBe(true);
    expect(await git(work.repo, "rev-parse", "HEAD")).toBe(work.head);
    expect(await git(work.repo, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(work.repo, ".git", "index"))).toEqual(work.index);
    expect(readFileSync(join(work.repo, "a.txt"), "utf8")).toBe("original a\n");
    expect((await decide(work.room, "discard")).status).toBe(409);
    expect((await api("PATCH", `/api/groups/${work.room.id}`, { branchFiles: [] })).status).toBe(409);
    writeFileSync(work.finish, "finish");
  };
  try {
    const clean = await make("clean");
    await awaitWorkers(clean);
    await expect.poll(async () => (await card(clean.room)).goalRun?.status, { timeout: 25_000 }).toBe("completed");
    const done = (await card(clean.room)).goalRun!;
    expect(done.branches).toMatchObject({ decision: "pending", tasks: [{ phase: "merged", changed: ["a.txt"] }, { phase: "merged", changed: ["b.txt"] }] });
    const turns = JSON.parse(`[${readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").join(",")}]`) as Array<{ botId: string; cwd: string; threadId: string }>;
    const workers = turns.filter((turn) => turn.botId === clean.bots[1]!.id || turn.botId === clean.bots[2]!.id);
    expect(new Set(workers.map((turn) => turn.cwd)).size).toBe(2);
    expect(new Set(workers.map((turn) => turn.threadId)).size).toBe(2);
    const checker = turns.find((turn) => turn.botId === clean.bots[3]!.id)!;
    expect(checker.cwd).not.toBe(clean.repo);
    expect(readFileSync(join(checker.cwd, ".env.local"), "utf8")).toBe("FIXTURE_ONLY=yes\n");
    expect(readFileSync(join(checker.cwd, "verify.log"), "utf8")).toContain(checker.cwd);
    expect(await git(clean.repo, "status", "--porcelain")).toBe("");
    expect((await decide(clean.room, "merge", false)).status).toBe(400);
    expect((await decide(clean.room, "keep")).status).toBe(200);
    await restart();
    expect((await decide(clean.room, "merge")).status).toBe(200);
    expect(readFileSync(join(clean.repo, "a.txt"), "utf8")).toBe("worker a\n");
    expect(readFileSync(join(clean.repo, "b.txt"), "utf8")).toBe("worker b\n");
    const mergedHead = await git(clean.repo, "rev-parse", "HEAD");
    await restart();
    expect((await decide(clean.room, "merge")).status).toBe(200);
    expect(await git(clean.repo, "rev-parse", "HEAD")).toBe(mergedHead);

    const conflict = await make("conflict", true);
    await awaitWorkers(conflict);
    await expect.poll(async () => (await card(conflict.room)).goalRun?.status, { timeout: 30_000 }).toBe("completed");
    expect((await card(conflict.room)).goalRun!.branches!.tasks.map((task) => task.phase)).toEqual(["merged", "superseded", "merged"]);
    expect((await messages(conflict.room)).some((message) => message.tool?.name.includes("repairs task b (1/2)"))).toBe(true);
    writeFileSync(join(conflict.repo, "human.txt"), "keep my edit\n");
    expect((await decide(conflict.room, "merge")).status).toBe(409);
    expect(readFileSync(join(conflict.repo, "human.txt"), "utf8")).toBe("keep my edit\n");
    expect((await decide(conflict.room, "discard")).status).toBe(200);
    expect(readFileSync(join(conflict.repo, "a.txt"), "utf8")).toBe("original a\n");

    const failed = await make("unresolved", true, { failRepair: true });
    await awaitWorkers(failed);
    await expect.poll(async () => (await card(failed.room)).goalRun?.status, { timeout: 30_000 }).toBe("needs-input");
    expect((await card(failed.room)).goalRun!.detail).toContain("two repair attempts");
    expect((await card(failed.room)).goalRun!.branches!.tasks).toHaveLength(4);
    expect((await card(failed.room)).goalRun!.branches!.tasks.map((task) => task.phase)).toEqual(["merged", "conflict", "superseded", "superseded"]);
    expect(await git(failed.repo, "rev-parse", "HEAD")).toBe(failed.head);

    const repaired = await make("tester-fix", false, { testerFail: true });
    await awaitWorkers(repaired);
    await expect.poll(async () => (await card(repaired.room)).goalRun?.status, { timeout: 25_000 }).toBe("completed");
    expect((await card(repaired.room)).goalRun!.branches!.tasks.map((task) => [task.taskId, task.botId])).toEqual([["a", repaired.bots[1]!.id], ["b", repaired.bots[2]!.id], ["fix-a", repaired.bots[1]!.id]]);
    expect(await git(repaired.repo, "status", "--porcelain")).toBe("");

    const stopped = await make("stop-resume", false, { stopAtTester: true });
    await awaitWorkers(stopped);
    await expect.poll(() => existsSync(join(dataDir, "stop-resume-tester-ready")), { timeout: 20_000 }).toBe(true);
    expect((await api("POST", `/api/groups/${stopped.room.id}/interrupt`, { threadId: stopped.room.threadId })).status).toBe(200);
    await expect.poll(async () => (await card(stopped.room)).goalRun?.status, { timeout: 10_000 }).toBe("stopped");
    const old = (await card(stopped.room)).goalRun!.branches!;
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).body.groups.find((group: WireGroup) => group.id === stopped.room.id)?.working, { timeout: 15_000 }).toBe(false);
    const [resumeLead, , , resumeTester, resumeReviewer] = stopped.bots as [WireBot, WireBot, WireBot, WireBot, WireBot];
    const first = (plans[resumeLead.id] as any).turns[0];
    plans[resumeLead.id] = { turns: [first, { reply: envelope({ status: "continue", brief: { goal: stopped.goal }, tasks: [{ id: "test-retained", assignee: resumeTester.id, instruction: "Test retained integration" }, { id: "review-retained", assignee: resumeReviewer.id, instruction: "Review retained integration" }] }) }, { reply: envelope({ status: "completed", detail: "Retained work checked" }) }] };
    plans[resumeTester.id] = { reply: "VERDICT: PASS" };
    writeFileSync(planPath, JSON.stringify(plans));
    expect((await api("POST", `/api/groups/${stopped.room.id}/messages`, { text: stopped.goal, mode: "goal" })).status).toBe(202);
    await expect.poll(async () => (await card(stopped.room)).goalRun?.status, { timeout: 25_000 }).toBe("completed");
    expect((await card(stopped.room)).goalRun!.branches).toMatchObject({ runId: old.runId, head: old.head });
    expect((await card(stopped.room)).goalRun!.branches!.tasks).toHaveLength(2);
    expect(await git(stopped.repo, "rev-parse", "HEAD")).toBe(stopped.head);

    const dirty = await make("dirty", false, { dirty: true });
    await expect.poll(async () => (await card(dirty.room)).goalRun?.status, { timeout: 10_000 }).toBe("blocked");
    expect((await card(dirty.room)).goalRun!.turnCount).toBe(0);
    expect(readFileSync(join(dirty.repo, "dirty.txt"), "utf8")).toBe("human change\n");
    expect((await api("PATCH", `/api/groups/${dirty.room.id}`, { kind: "research" })).body.group.isolatedBranches).toBe(false);
    const control = async (...args: string[]) => { const result = await runControlOmb([...args, "--url", url]); evidence.push({ control: args, result }); };
    await control("wait", "--channel", conflict.room.id, "--task", conflict.room.threadId, "--timeout", "10");
    await control("messages", "--channel", conflict.room.id, "--task", conflict.room.threadId, "--limit", "30");
  } finally {
    if (restarted) await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
    const evidencePath = `${fixture.info.logPath}.goal-branches.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    expect(existsSync(dataDir)).toBe(false);
    console.info(JSON.stringify({ ...fixture.info, evidencePath, fixtureRemoved: true }));
  }
}, 150_000);
