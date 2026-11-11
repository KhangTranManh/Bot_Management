import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import { whichWin } from "../../server/env-path.ts";
import { fixtureApi, mountPreview } from "./preview-fixture.ts";
import { neonBrowser } from "./neon-browser.ts";

const gitBinary = whichWin("git");
assert.ok(gitBinary, "The isolated branch check needs Git");
const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true, gitBinary });
const evidence = resolve(".omb-scratch/verify-evidence/goal-branches");
mkdirSync(evidence, { recursive: true });
const git = (cwd: string, ...args: string[]) => new Promise<string>((done, fail) => execFile(gitBinary, args, { cwd, encoding: "utf8", windowsHide: true }, (error, stdout) => error ? fail(error) : done(stdout.trim())));
const envelope = (value: unknown) => `<openmaus-goal>${JSON.stringify(value)}</openmaus-goal>`;
let browser: Awaited<ReturnType<typeof neonBrowser>> | undefined;
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
const evaluate = async (source: string) => (await browser!(["eval", source])).result as any;
const waitFor = async (source: string) => {
  const deadline = Date.now() + 30_000;
  while (!await evaluate(source)) {
    if (Date.now() > deadline) throw new Error(`Branch UI did not settle: ${source}`);
    await new Promise((done) => setTimeout(done, 150));
  }
};
try {
  const api = fixtureApi(fixture.info.url);
  await api("PATCH", "/api/config", { language: "vi" });
  for (const bot of (await api("GET", "/api/bots")).bots.filter((bot: any) => bot.defaultBot)) await api("PATCH", `/api/bots/${bot.id}`, { welcomed: true });
  const repo = join(fixture.info.dataDir, "project");
  mkdirSync(repo);
  await git(repo, "init", "--quiet"); await git(repo, "config", "core.autocrlf", "false"); await git(repo, "config", "user.name", "Fixture"); await git(repo, "config", "user.email", "fixture@localhost");
  writeFileSync(join(repo, "inventory.txt"), "before\n");
  writeFileSync(join(repo, "check.cjs"), `require('node:assert/strict').equal(require('node:fs').readFileSync('inventory.txt','utf8'),${JSON.stringify("checked inventory\n")}); console.log('passed');`);
  await git(repo, "add", "."); await git(repo, "-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "fixture");
  const originalHead = await git(repo, "rev-parse", "HEAD");
  const bots = [];
  for (const name of ["Lead", "Worker", "Tester", "Reviewer"]) bots.push((await api("POST", "/api/bots", { name })).bot);
  const [lead, worker, tester, reviewer] = bots;
  const room = (await api("POST", "/api/groups", { name: "Branch inventory", memberIds: bots.map((bot: any) => bot.id), setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } } })).group;
  await api("PATCH", `/api/groups/${room.id}`, { kind: "code", cwd: repo, verify: [{ id: "inventory", command: "node check.cjs" }], roles: { [lead.id]: "lead", [worker.id]: "worker", [tester.id]: "tester", [reviewer.id]: "reviewer" } });
  writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({
    [lead.id]: { turns: [{ reply: envelope({ status: "continue", brief: { goal: "Build checked inventory", acceptance: ["inventory check passes"] }, tasks: [{ id: "inventory", assignee: worker.id, instruction: "Build inventory", writes: ["inventory.txt"] }] }) }, { reply: envelope({ status: "completed", detail: "Built, tested and reviewed" }) }] },
    [worker.id]: { writeFiles: { "inventory.txt": "checked inventory\n" }, reply: "Inventory built." },
    [tester.id]: { reply: "VERDICT: PASS" }, [reviewer.id]: { reply: "REVIEW: CLEAR" },
  }));
  browser = await neonBrowser(join(fixture.info.dataDir, "chrome-profile"), process.env.AGENT_BROWSER_EXECUTABLE_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe");
  preview = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__goal-branches.html", title: "Isolated goal branch verification", logLevel: "warn" });
  console.log(JSON.stringify({ fixture: fixture.info, preview: preview.previewUrl, evidence }));
  await browser(["set", "viewport", "1366", "768"]);
  await browser(["open", preview.previewUrl]);
  await waitFor("Boolean(document.querySelector('[data-office-nav]'))");
  await evaluate("localStorage.setItem('omb-skin','neon'); location.reload(); true");
  await waitFor("Boolean(document.querySelector('[data-office-nav]'))");
  await evaluate("document.querySelector('[data-office-nav]').click(); true");
  await waitFor("Boolean(document.querySelector('[aria-label=\"Mở room Branch inventory\"]'))");
  await evaluate("document.querySelector('[aria-label=\"Mở room Branch inventory\"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); true");
  await waitFor("Boolean(document.querySelector('.workflow-branches input'))");
  assert.equal(await evaluate("document.querySelector('.workflow-branches input').checked"), false);
  await evaluate("document.querySelector('.workflow-branches input').click(); true");
  await waitFor("[...document.querySelectorAll('.room-workflow-settings button')].some(button=>button.textContent==='Lưu cài đặt'&&!button.disabled)");
  await evaluate("[...document.querySelectorAll('.room-workflow-settings button')].find(button=>button.textContent==='Lưu cài đặt').click(); true");
  await waitFor("document.querySelector('.room-workflow-settings').textContent.includes('Đã lưu cài đặt room.')");
  assert.equal((await api("GET", "/api/bots?messages=0")).groups.find((group: any) => group.id === room.id).isolatedBranches, true);
  await evaluate("document.querySelector('.workflow-branches').scrollIntoView({block:'center'}); true");
  await browser(["screenshot", join(evidence, "settings.png")]);
  await evaluate("document.querySelector('[data-room-panel] > div:first-child > button:last-child').click(); true");
  await waitFor("!document.querySelector('[data-room-panel]')");
  await api("POST", `/api/groups/${room.id}/messages`, { text: "Build checked inventory", mode: "goal" });
  await runControlOmb(["wait", "--channel", room.id, "--task", room.threadId, "--timeout", "30", "--url", fixture.info.url]);
  const completed = (await api("GET", `/api/threads/${room.threadId}/messages`)).messages.find((message: any) => message.goalRun)?.goalRun;
  writeFileSync(join(evidence, "provider-turns.json"), readFileSync(join(fixture.info.dataDir, "room-plan.json.evidence.jsonl")));
  writeFileSync(join(evidence, "goal.json"), JSON.stringify(completed, null, 2));
  assert.equal(completed?.status, "completed", completed?.detail);
  await waitFor("Boolean([...document.querySelectorAll('[data-goal-branches] button')].find(button=>button.textContent==='Merge vào branch gốc'&&!button.disabled))");
  assert.equal(await git(repo, "rev-parse", "HEAD"), originalHead);
  const bounds = [];
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await browser(["set", "viewport", String(width), String(height)]);
    if (width < 768) await waitFor("document.querySelector('[data-sidebar]').getBoundingClientRect().right <= 1");
    await evaluate("document.querySelector('[data-goal-branches]').scrollIntoView({block:'center'}); document.fonts.ready.then(()=>true)");
    const measured = await evaluate("({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1})");
    assert.equal(measured.overflow, false); bounds.push(measured);
    await browser(["screenshot", join(evidence, `card-${width}.png`)]);
  }
  const merge = "[...document.querySelectorAll('[data-goal-branches] button')].find(button=>button.textContent==='Merge vào branch gốc')";
  await evaluate(`${merge}.click(); true`);
  await waitFor("Boolean(document.querySelector('[aria-label=\"Xác nhận merge goal\"]'))");
  assert.equal(await git(repo, "rev-parse", "HEAD"), originalHead);
  await evaluate("[...document.querySelectorAll('[data-goal-branches] button')].find(button=>button.textContent==='Huỷ').click(); true");
  assert.equal(await git(repo, "rev-parse", "HEAD"), originalHead);
  await evaluate(`${merge}.click(); true`);
  await waitFor("Boolean(document.querySelector('[aria-label=\"Xác nhận merge goal\"]'))");
  await evaluate("[...document.querySelectorAll('[data-goal-branches] button')].find(button=>button.textContent==='Xác nhận merge').click(); true");
  await waitFor("document.querySelector('[data-goal-branches]').textContent.includes('Đã merge vào branch gốc')");
  assert.equal(readFileSync(join(repo, "inventory.txt"), "utf8"), "checked inventory\n");
  assert.notEqual(await git(repo, "rev-parse", "HEAD"), originalHead);
  const wait = await runControlOmb(["wait", "--channel", room.id, "--task", room.threadId, "--timeout", "10", "--url", fixture.info.url]);
  const messages = await runControlOmb(["messages", "--channel", room.id, "--task", room.threadId, "--limit", "30", "--url", fixture.info.url]);
  const consoleLog = await browser(["console"]);
  assert.equal(consoleLog.logs.filter((entry: any) => entry.type === "error").length, 0);
  writeFileSync(join(evidence, "result.json"), JSON.stringify({ ok: true, fixture: fixture.info, bounds, originalHead, mergedHead: await git(repo, "rev-parse", "HEAD"), wait, messages, consoleLog }, null, 2));
  console.log(JSON.stringify({ ok: true, evidence, bounds }));
} finally {
  await browser?.(["close"]).catch(() => {});
  await preview?.close();
  await fixture.close();
}
