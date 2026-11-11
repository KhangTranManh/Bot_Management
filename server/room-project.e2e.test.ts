import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { GroupGoalRunCardData } from "../shared/group-goal-run.ts";
import type { WireBot, WireGroup, WireMessage } from "../shared/wire.ts";

it("keeps a server baseline before bot work, persists it on the card, and still refuses failing completion checks", async () => {
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_MODE: "happy",
    FAKE_CLAUDE_REPLIES: JSON.stringify(['Done.\n<openmaus-goal>{"status":"completed","detail":"Checks repaired."}</openmaus-goal>']),
  });
  const { url, dataDir } = fixture.info;
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const api = async <T>(method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = { status: response.status, body: await response.json() as T };
    evidence.push({ method, path, body, result });
    return result;
  };
  const control = async (...args: string[]) => {
    const result = await runControlOmb([...args, "--url", url]);
    evidence.push({ control: args, result });
    return result;
  };
  const messages = async (threadId: string) => (await api<{ messages: WireMessage[] }>("GET", `/api/threads/${threadId}/messages`)).body.messages;
  const card = async (room: WireGroup): Promise<GroupGoalRunCardData | undefined> => (await messages(room.threadId)).filter((message) => message.goalRun).at(-1)?.goalRun;
  try {
    const bot = (await api<{ bot: WireBot }>("POST", "/api/bots", { name: "Project lead" })).body.bot;
    const makeRoom = async (name: string) => (await api<{ group: WireGroup }>("POST", "/api/groups", { name, memberIds: [bot.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } } })).body.group;
    const room = await makeRoom("Existing project");
    const work = join(dataDir, "work");
    mkdirSync(work);
    writeFileSync(join(work, "setup.cjs"), 'require("node:fs").appendFileSync("order.txt", "setup\\n");');
    writeFileSync(join(work, "check.cjs"), 'const fs = require("node:fs"); fs.appendFileSync("order.txt", "verify\\n"); const n = fs.readFileSync("order.txt", "utf8").split("verify").length - 1; console.log(n === 1 ? "Existing failure before bot work" : "Repaired by synthetic check fixture"); process.exit(n === 1 ? 1 : 0);');
    const profile = { instructions: "Follow AGENTS.md; use readable code", moduleMap: "src: inventory service", protectedPaths: ["vendor/"], setup: [{ id: "deps", command: "node setup.cjs" }] };
    expect((await api("PATCH", `/api/groups/${room.id}`, { cwd: work, verify: [{ id: "tests", command: "node check.cjs" }], projectProfile: profile })).status).toBe(200);
    const persisted = (await api<{ groups: WireGroup[] }>("GET", "/api/bots?messages=0")).body.groups.find((group) => group.id === room.id)!;
    expect(persisted.projectProfile).toMatchObject({ instructions: profile.instructions, protectedPaths: ["vendor"] });
    const savedGroups = JSON.parse(readFileSync(join(dataDir, "groups.json"), "utf8")) as WireGroup[];
    expect(savedGroups.find((group) => group.id === room.id)?.projectProfile).toEqual(persisted.projectProfile);
    for (const bad of [{ setup: [{ id: "deps", command: "node setup.cjs", cwd: "../outside" }] }, { protectedPaths: ["../outside"] }, { instructions: 4 }]) {
      expect((await api("PATCH", `/api/groups/${room.id}`, { projectProfile: bad })).status).toBe(400);
    }
    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Repair this project", mode: "goal" })).status).toBe(202);
    await expect.poll(async () => (await card(room))?.status, { timeout: 20_000 }).toBe("completed");
    const completed = (await card(room))!;
    expect(completed).toMatchObject({ turnCount: 1, baseline: { setup: [{ id: "deps", exitCode: 0 }], checks: [{ id: "tests", exitCode: 1, output: expect.stringContaining("Existing failure") }] } });
    const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { prompt: unknown; systemPrompt: string };
    const instructions = `${JSON.stringify(dump.prompt)}\n${dump.systemPrompt}`;
    expect(instructions).toContain("tests: FAIL, exit 1");
    expect(instructions).toContain("src: inventory service");
    expect(readFileSync(join(work, "order.txt"), "utf8")).toBe("setup\nverify\nverify\n");
    await control("wait", "--channel", room.id, "--task", room.threadId, "--timeout", "10");
    await control("messages", "--channel", room.id, "--task", room.threadId, "--limit", "30");

    const failing = await makeRoom("Still failing project");
    expect((await api("PATCH", `/api/groups/${failing.id}`, { cwd: work, projectProfile: {}, verify: [{ id: "broken", command: 'node -e "process.exit(1)"' }] })).status).toBe(200);
    expect((await api("POST", `/api/groups/${failing.id}/messages`, { text: "Fix this", mode: "goal" })).status).toBe(202);
    await expect.poll(async () => (await card(failing))?.status, { timeout: 20_000 }).toBe("blocked");
    expect(await card(failing)).toMatchObject({ baseline: { checks: [{ id: "broken", exitCode: 1 }] }, detail: expect.stringContaining("kept failing after 3 fix rounds") });
    await control("wait", "--channel", failing.id, "--task", failing.threadId, "--timeout", "10");
    await control("messages", "--channel", failing.id, "--task", failing.threadId, "--limit", "30");

    const setupFailure = await makeRoom("Setup failure");
    const dumpBefore = readFileSync(fixture.fixtureDumpPath, "utf8");
    expect((await api("PATCH", `/api/groups/${setupFailure.id}`, { cwd: work, projectProfile: { setup: [{ id: "deps", command: 'node -e "process.exit(1)"' }] } })).status).toBe(200);
    expect((await api("POST", `/api/groups/${setupFailure.id}/messages`, { text: "Build", mode: "goal" })).status).toBe(202);
    await expect.poll(async () => (await card(setupFailure))?.status, { timeout: 10_000 }).toBe("blocked");
    expect(await card(setupFailure)).toMatchObject({ turnCount: 0, baseline: { setup: [{ id: "deps", exitCode: 1 }], checks: [] } });
    expect(readFileSync(fixture.fixtureDumpPath, "utf8")).toBe(dumpBefore);

    const missingFolder = await makeRoom("Profile needs a folder");
    expect((await api("PATCH", `/api/groups/${missingFolder.id}`, { projectProfile: {}, verify: [{ id: "ready", command: 'node -e "process.exit(0)"' }] })).status).toBe(200);
    expect((await api("POST", `/api/groups/${missingFolder.id}/messages`, { text: "Build", mode: "goal" })).status).toBe(202);
    await expect.poll(async () => (await card(missingFolder))?.status, { timeout: 10_000 }).toBe("blocked");
    expect((await card(missingFolder))!.turnCount).toBe(0);
    expect((await api("PATCH", `/api/groups/${missingFolder.id}`, { cwd: work })).status).toBe(200);
    expect((await api("POST", `/api/groups/${missingFolder.id}/messages`, { text: "Build with the folder set", mode: "goal" })).status).toBe(202);
    await expect.poll(async () => (await card(missingFolder))?.status, { timeout: 10_000 }).toBe("completed");
    expect(await card(missingFolder)).toMatchObject({ baseline: { checks: [{ id: "ready", exitCode: 0 }] } });
    expect((await api("PATCH", `/api/groups/${room.id}`, { projectProfile: null })).status).toBe(200);
    const cleared = (await api<{ groups: WireGroup[] }>("GET", "/api/bots?messages=0")).body.groups.find((group) => group.id === room.id)!;
    expect(cleared.projectProfile).toBeUndefined();
    expect((await card(room))!.baseline).toEqual(completed.baseline);
  } finally {
    await fixture.close();
    const evidencePath = `${fixture.info.logPath}.room-project.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    expect(existsSync(dataDir)).toBe(false);
    console.info(JSON.stringify({ ...fixture.info, evidencePath, fixtureRemoved: true }));
  }
}, 75_000);
