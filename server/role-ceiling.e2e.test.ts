// Real server + injected MCP tools; only the provider's planning is scripted.
// NOTE.md §1.1 / B0(i): a coordination node's recorded level is a hard ceiling — a consulted teammate
// runs at Ask even when its own grant is Full access, and the app never auto-approves above it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it.each([
  ["1", "default"],
  ["0", "bypassPermissions"],
])("with OMB_ROLE_CEILING=%s a consulted Full-access teammate runs at permissionMode %s", async (flag, expected) => {
  const fixture = await launchVerificationServer({ OMB_ROLE_CEILING: flag }, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = fixture.info;
  const planPath = join(dataDir, "room-plan.json");
  const plans: Record<string, { turns: any[] }> = {};
  const providerTurns = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, { method,
      headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const unanswered = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages
    .filter((message: any) => message.card && !message.card.answered && !message.card.dismissed);
  const plan = (botId: string, ...turns: any[]) => { (plans[botId] ??= { turns: [] }).turns.push(...turns); writeFileSync(planPath, JSON.stringify(plans)); };
  const turnOf = (botId: string, index = 0) => providerTurns().filter(turn => turn.botId === botId)[index];
  try {
    const lead = (await cli("new-bot", "--name", "Rowan", "--section", "Operations")).bot;
    const mate = (await cli("new-bot", "--name", "Sable", "--section", "Operations")).bot;
    await api("PATCH", `/api/bots/${mate.id}`, { approvalMode: "full", applyToAllThreads: true });

    plan(lead.id,
      { steps: [{ tool: "coordinate_bots", arguments: { bot_ids: [mate.id], consult: true, request_key: "ask-sable", message: "Advise on the rollout order only; change nothing." }, expectError: false }], reply: "Asked Sable for advice." },
      { reply: "Sable's advice is in." });
    plan(mate.id, { reply: "Advice: roll out in two stages." });
    await cli("send", "--bot", lead.id, "--task", lead.activeTaskId, "--text", "Get Sable's advice on the rollout order.");
    await expect.poll(() => providerTurns().filter(turn => turn.botId === mate.id).length, { timeout: 30_000 }).toBe(1);
    expect((await cli("wait", "--bot", lead.id, "--task", lead.activeTaskId, "--timeout", "25")).status).toBe("settled");

    const mateTurn = turnOf(mate.id);
    expect(mateTurn.permissionMode, `the consult node records Ask; the teammate's own grant is Full`).toBe(expected);
    // The teammate's saved grant is untouched; the ceiling lives on the assignment, not the bot.
    expect((await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === mate.id).approvalMode).toBe("full");
    expect(await unanswered(mateTurn.threadId)).toHaveLength(0);
    expect(readFileSync(logPath, "utf8")).not.toMatch(/ReferenceError|change listener threw|Unexpected extra fixture turn/);
  } finally {
    console.info(JSON.stringify({ logPath, providerTurns: providerTurns().map(turn => ({ botId: turn.botId, permissionMode: turn.permissionMode })) }));
    await fixture.close();
  }
}, 120_000);

// The ceiling only lowers: a Chief's recorded lift still raises an Ask teammate when the flag is on.
it("with OMB_ROLE_CEILING=1 a Chief's delegation still lifts an Ask teammate", async () => {
  const fixture = await launchVerificationServer({ OMB_ROLE_CEILING: "1" }, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = fixture.info;
  const planPath = join(dataDir, "room-plan.json");
  const plans: Record<string, { turns: any[] }> = {};
  const providerTurns = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, { method,
      headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const plan = (botId: string, ...turns: any[]) => { (plans[botId] ??= { turns: [] }).turns.push(...turns); writeFileSync(planPath, JSON.stringify(plans)); };
  const turnOf = (botId: string, index = 0) => providerTurns().filter(turn => turn.botId === botId)[index];
  try {
    const chief = (await cli("new-bot", "--name", "Vera", "--section", "Operations")).bot;
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, approvalMode: "full", applyToAllThreads: true });
    const worker = (await cli("new-bot", "--name", "Iris", "--section", "Operations")).bot;
    await api("PATCH", `/api/bots/${worker.id}`, { approvalMode: "ask" });

    plan(chief.id,
      { steps: [{ tool: "coordinate_bots", arguments: { bot_ids: [worker.id], request_key: "lift-iris", message: "Run the migration check." }, expectError: false }], reply: "Handed to Iris." },
      { reply: "Iris reported." });
    plan(worker.id, { reply: "Migration check done." });
    await cli("send", "--bot", chief.id, "--task", chief.activeTaskId, "--text", "Have Iris run the migration check.");
    await expect.poll(() => providerTurns().filter(turn => turn.botId === worker.id).length, { timeout: 30_000 }).toBe(1);
    expect((await cli("wait", "--bot", chief.id, "--task", chief.activeTaskId, "--timeout", "25")).status).toBe("settled");
    // The node records the Chief's Full access, so the cap keeps the lift; Iris's own grant stays Ask.
    expect(turnOf(worker.id).permissionMode).toBe("bypassPermissions");
    expect((await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === worker.id).approvalMode).toBe("ask");
  } finally {
    console.info(JSON.stringify({ logPath, providerTurns: providerTurns().map(turn => ({ botId: turn.botId, permissionMode: turn.permissionMode })) }));
    await fixture.close();
  }
}, 120_000);
