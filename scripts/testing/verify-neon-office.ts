import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { launchVerificationServer } from "../control-omb.ts";
import { neonBrowser } from "./neon-browser.ts";
import { fixtureApi, mountPreview } from "./preview-fixture.ts";

const fixture = await launchVerificationServer();
const evidence = resolve(".omb-scratch/verify-evidence/neon-office");
mkdirSync(evidence, { recursive: true });
const chrome = process.env.AGENT_BROWSER_EXECUTABLE_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
let browser: Awaited<ReturnType<typeof neonBrowser>>;
const evaluate = async (text: string) => (await browser(["eval", text])).result as any;
const waitFor = async (text: string) => {
  const end = Date.now() + 25_000;
  for (;;) {
    if (await evaluate(text)) return;
    if (Date.now() >= end) throw new Error(`UI did not settle: ${text}`);
    await new Promise((done) => setTimeout(done, 200));
  }
};
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  browser = await neonBrowser(join(fixture.info.dataDir, "chrome-profile"), chrome);
  const api = fixtureApi(fixture.info.url);
  await api("PATCH", "/api/config", { language: "vi" });
  const initial = await api("GET", "/api/bots");
  for (const bot of initial.bots.filter((bot: any) => bot.defaultBot)) await api("PATCH", `/api/bots/${bot.id}`, { welcomed: true });
  const bots = [];
  for (const name of ["Lead", "Terra", "Luna", "Tester"]) bots.push((await api("POST", "/api/bots", { name, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } })).bot);
  const room = (await api("POST", "/api/groups", { name: "Inventory service", memberIds: bots.map((bot: any) => bot.id), setup: { bulletin: "", defaultResponder: { kind: "member", botId: bots[0].id } } })).group;
  await api("PATCH", `/api/groups/${room.id}`, { kind: "code", roles: Object.fromEntries(bots.map((bot: any, i: number) => [bot.id, ["lead", "worker", "worker", "tester"][i]])) });
  const research = (await api("POST", "/api/groups", { name: "CPU research", memberIds: [bots[1].id, bots[2].id], setup: { bulletin: "", defaultResponder: { kind: "mentions" } } })).group;
  const work = join(fixture.info.dataDir, "research-work");
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "goal.json"), JSON.stringify({ name: "Fixture goal", metric: { file: "metric.json", pointer: "/score", threshold: .9, direction: "at-least" }, seeds: { count: 1, aggregation: "mean" }, budget: { wallMinutes: 5 }, verify: [{ id: "score", command: "node score.js" }] }));
  await api("PATCH", `/api/groups/${research.id}`, { kind: "research", cwd: work });
  const schema = () => ["messages.db", "runtime.db"].map((file) => {
    const db = new DatabaseSync(join(fixture.info.dataDir, file), { readOnly: true });
    try { return db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all(); }
    finally { db.close(); }
  });
  const schemaBefore = schema();
  preview = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__neon.html", title: "Isolated Neon Office", logLevel: "warn" });
  console.log(JSON.stringify({ url: fixture.info.url, preview: preview.previewUrl, log: fixture.info.logPath, evidence }));
  await browser(["open", preview.previewUrl]);
  await waitFor("Boolean(document.querySelector('[data-office-nav]'))");
  await evaluate("localStorage.setItem('omb-skin','neon');location.reload();true");
  await waitFor("Boolean(document.querySelector('[data-office-nav]'))");
  await evaluate("document.querySelector('[data-office-nav]').click();true");
  await waitFor("Boolean(document.querySelector('[data-office-page] [data-office-room]'))");
  assert.equal(await evaluate("document.documentElement.dataset.skin"), "neon");
  const bounds = [];
  for (const [width, height, scale = 1] of [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [390, 844], [683, 384, 2]]) {
    await browser(["set", "viewport", String(width), String(height), String(scale)]);
    await evaluate("document.fonts.ready.then(()=>true)");
    await new Promise((done) => setTimeout(done, 750));
    const measured = await evaluate(`(() => { const page=document.querySelector('[data-office-page]'); const r=page.getBoundingClientRect();const list=page.querySelector('.office-room-list');const side=document.querySelector('[data-sidebar-root]');return {width:innerWidth,pageWidth:r.width,overflow:document.documentElement.scrollWidth>innerWidth+1,roomList:getComputedStyle(list).display,sidebarWidth:side?.getBoundingClientRect().width}; })()`);
    assert.equal(measured.overflow, false, `horizontal overflow at ${width}`);
    if (width === 1366) assert.ok(Math.abs(measured.sidebarWidth - 240) < 1);
    if (width === 390) assert.notEqual(measured.roomList, "none");
    bounds.push(measured);
    await browser(["screenshot", join(evidence, `office-${width}.png`)]);
  }
  await browser(["set", "viewport", "1366", "768"]);
  await evaluate("document.querySelector('.office-filters button:nth-child(3)').click();true");
  await waitFor("document.querySelectorAll('[data-office-room]').length===1");
  assert.match(await evaluate("document.querySelector('[data-office-room]').textContent"), /CPU research/);
  await evaluate("document.querySelector('.office-filters button').click();true");
  await waitFor("document.querySelectorAll('[data-office-room]').length===2");
  await evaluate("document.querySelector('.office-bot').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));true");
  assert.ok(await evaluate("Boolean(document.querySelector('.office-bot[aria-pressed=true]'))"));
  await evaluate(`document.querySelector('[aria-label="Mở room Inventory service"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
  await waitFor("Boolean(document.querySelector('[data-room-panel] .room-workflow-settings'))");
  await evaluate("[...document.querySelectorAll('.room-workflow-settings button')].find(b=>b.textContent==='Thêm').click();true");
  await evaluate(`(() => { const input=document.querySelector('[aria-label="Lệnh verify 1"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'npm test');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await evaluate("[...document.querySelectorAll('.room-workflow-settings button')].find(b=>b.textContent==='Lưu cài đặt').click();true");
  await waitFor("document.querySelector('.room-workflow-settings').textContent.includes('Đã lưu cài đặt room.')");
  const saved = (await api("GET", "/api/bots")).groups.find((group: any) => group.id === room.id);
  assert.equal(saved.verify[0].command, "npm test");
  assert.equal(saved.kind, "code");
  await evaluate("document.querySelector('.room-workflow-settings').scrollIntoView({block:'start'});true");
  await browser(["screenshot", join(evidence, "room-settings.png")]);
  await evaluate("document.querySelector('[data-office-nav]').click();true");
  await waitFor("Boolean(document.querySelector('[aria-label=\"Mở room CPU research\"]'))");
  await evaluate("document.querySelector('[aria-label=\"Mở room CPU research\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true");
  await waitFor("Boolean(document.querySelector('[aria-label=\"File goal\"]'))");
  const fileInput = (value: string) => evaluate(`(() => { const input=document.querySelector('[aria-label="File goal"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  const click = (label: string) => evaluate(`(() => { const button=[...document.querySelectorAll('.room-workflow-settings button')].find(b=>b.textContent===${JSON.stringify(label)});button.scrollIntoView({block:'center'});button.click();return true;})()`);
  await fileInput("missing.json"); await click("Lưu cài đặt");
  await waitFor("document.querySelector('.room-workflow-settings').textContent.includes('Đã lưu cài đặt room.')");
  await click("Duyệt file goal");
  await waitFor("Boolean(document.querySelector('.room-workflow-settings [role=alert]'))");
  await fileInput("goal.json"); await click("Lưu cài đặt");
  await waitFor("document.querySelector('.room-workflow-settings').textContent.includes('Đã lưu cài đặt room.')");
  await click("Duyệt file goal");
  await waitFor("document.querySelector('.room-workflow-settings').textContent.includes('Server đã duyệt')");
  const approved = (await api("GET", "/api/bots")).groups.find((group: any) => group.id === research.id);
  assert.match(approved.goalFileHash, /^[a-f0-9]{64}$/);
  await evaluate("document.querySelector('.room-workflow-settings').scrollIntoView({block:'start'});true");
  await browser(["screenshot", join(evidence, "research-settings.png")]);
  await evaluate("localStorage.setItem('openmausbot.sidebarWidth','300');localStorage.setItem('openmausbot.sidebarWidth.simple','300');localStorage.setItem('omb-skin','daylight');location.reload();true");
  await waitFor("Boolean(document.querySelector('[data-office-nav]'))");
  assert.equal(await evaluate("document.documentElement.dataset.skin"), "daylight");
  await evaluate("document.querySelector('[data-office-nav]').click();true");
  await waitFor("Boolean(document.querySelector('[data-office-page]'))");
  await new Promise((done) => setTimeout(done, 750));
  assert.ok(Math.abs(await evaluate("document.querySelector('[data-sidebar-root]').getBoundingClientRect().width") - 300) < 1);
  assert.deepEqual(schema(), schemaBefore, "UI must not change database schemas");
  const consoleLog = await browser(["console"]);
  assert.equal(consoleLog.logs.filter((log: any) => log.type === "error").length, 0);
  writeFileSync(join(evidence, "result.json"), JSON.stringify({ ok: true, fixtureLog: fixture.info.logPath, bounds, verifySaved: saved.verify, researchApproved: true, databaseSchemasUnchanged: true, console: consoleLog }, null, 2));
  console.log(JSON.stringify({ ok: true, bounds, evidence, console: consoleLog }, null, 2));
} finally {
  await browser?.(["close"]).catch(() => {});
  await preview?.close();
  await fixture.close();
}
