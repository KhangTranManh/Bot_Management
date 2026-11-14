import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import type { GroupGoalRunCardData } from "../shared/group-goal-run.ts";
import type { WireBot, WireGroup, WireMessage } from "../shared/wire.ts";

const outline = {
  brief: {
    goal: "Ship a notes app", inScope: ["notes CRUD"], outOfScope: ["sync"], acceptance: ["A note can be created and listed"], constraints: [], openQuestions: [],
    structure: [{ name: "backend", paths: ["server/"], owns: "API" }, { name: "frontend", paths: ["web/"], owns: "screens" }],
  },
  waves: [{ name: "Foundation", areas: ["backend"], deliverable: "A notes API" }, { name: "Screens", areas: ["frontend"], deliverable: "A notes list screen" }],
};
const envelope = (value: unknown) => `<openmaus-goal>${JSON.stringify(value)}</openmaus-goal>`;

it("keeps a /plan outline as a checked card, refuses tasks in it, and hands the saved outline to the next goal", async () => {
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_MODE: "happy",
    FAKE_CLAUDE_REPLY_STATE: join(mkdtempSync(join(tmpdir(), "omb-plan-")), "replies.count"),
    FAKE_CLAUDE_REPLIES: JSON.stringify([
      `Outline drafted.\n${envelope({ ...outline, tasks: [{ id: "t1" }] })}`,
      `Here is the outline.\n${envelope(outline)}`,
      `Done.\n${envelope({ status: "completed", detail: "Built to the outline." })}`,
    ]),
  });
  const { url, dataDir } = fixture.info;
  const work = join(dataDir, "work");
  mkdirSync(work);
  const api = async <T>(method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: await response.json() as T };
  };
  const messages = async (threadId: string) => (await api<{ messages: WireMessage[] }>("GET", `/api/threads/${threadId}/messages`)).body.messages;
  try {
    const bot = (await api<{ bot: WireBot }>("POST", "/api/bots", { name: "Project lead" })).body.bot;
    const room = (await api<{ group: WireGroup }>("POST", "/api/groups", { name: "Notes", memberIds: [bot.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } } })).body.group;
    expect((await api("PATCH", `/api/groups/${room.id}`, { cwd: work })).status).toBe(200);
    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "/plan a small notes app" })).status).toBe(202);
    const plan = async () => (await messages(room.threadId)).filter((message) => message.kind === "room.plan").at(-1)?.roomPlan;
    await expect.poll(async () => (await plan())?.status, { timeout: 20_000 }).toBe("ready");
    const ready = (await plan())!;
    expect(ready.draft).toEqual({ brief: expect.objectContaining({ goal: "Ship a notes app" }), waves: outline.waves });
    expect(JSON.stringify(await messages(room.threadId))).not.toContain("openmaus-goal");

    expect((await api("PATCH", `/api/groups/${room.id}`, { projectProfile: { plan: { ...ready.draft, tasks: [] } } })).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${room.id}`, { projectProfile: { plan: ready.draft } })).status).toBe(200);
    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Build it", mode: "goal" })).status).toBe(202);
    const card = async (): Promise<GroupGoalRunCardData | undefined> => (await messages(room.threadId)).filter((message) => message.goalRun).at(-1)?.goalRun;
    await expect.poll(async () => (await card())?.status, { timeout: 20_000 }).toBe("completed");
    expect((await card())?.planSource).toBeUndefined();
    const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { prompt: unknown; systemPrompt: string };
    expect(`${JSON.stringify(dump.prompt)}\n${dump.systemPrompt}`).toContain("1. Foundation [backend]: A notes API");
  } finally {
    await fixture.close();
  }
}, 60_000);
