import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import { fixtureApi, mountPreview } from "./preview-fixture.ts";
import { neonBrowser } from "./neon-browser.ts";

const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
const evidence = resolve(".omb-scratch/verify-evidence/goal-record");
mkdirSync(evidence, { recursive: true });
const envelope = (value: unknown) => `<openmaus-goal>${JSON.stringify(value)}</openmaus-goal>`;
let browser: Awaited<ReturnType<typeof neonBrowser>> | undefined;
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
const evaluate = async (source: string) => (await browser!(["eval", source])).result as any;
const waitFor = async (source: string) => {
  const deadline = Date.now() + 30_000;
  while (!await evaluate(source)) {
    if (Date.now() > deadline) throw new Error(`Goal record UI did not settle: ${source}`);
    await new Promise((done) => setTimeout(done, 150));
  }
};
const typeInto = (label: string, value: string) => evaluate(`(() => { const field=document.querySelector('[aria-label=${JSON.stringify(label)}]'); const proto=field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(field,${JSON.stringify(value)}); field.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
const projectButton = (text: string) => `[...document.querySelectorAll('[data-room-project-settings] button')].find(button=>button.textContent===${JSON.stringify(text)})`;
const roomOf = async (api: ReturnType<typeof fixtureApi>, id: string) => (await api("GET", "/api/bots?messages=0")).groups.find((group: any) => group.id === id);
try {
  const api = fixtureApi(fixture.info.url);
  await api("PATCH", "/api/config", { language: "vi" });
  for (const bot of (await api("GET", "/api/bots")).bots.filter((bot: any) => bot.defaultBot)) await api("PATCH", `/api/bots/${bot.id}`, { welcomed: true });
  const project = join(fixture.info.dataDir, "project");
  mkdirSync(project);
  writeFileSync(join(project, "setup.cjs"), "require('node:fs').writeFileSync('ready.txt','ready\\n'); console.log('setup done');");
  writeFileSync(join(project, "check.cjs"), "const fs=require('node:fs'); if(!fs.existsSync('cart.txt')){console.error('cart.txt missing');process.exit(1);} console.log('cart ok');");
  const bots = [];
  for (const name of ["Lead", "Worker", "Tester", "Reviewer"]) bots.push((await api("POST", "/api/bots", { name })).bot);
  const [lead, worker, tester, reviewer] = bots;
  const room = (await api("POST", "/api/groups", { name: "Checkout record", memberIds: bots.map((bot: any) => bot.id), setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } } })).group;
  await api("PATCH", `/api/groups/${room.id}`, { kind: "code", cwd: project, verify: [{ id: "cart", command: "node check.cjs" }], roles: { [lead.id]: "lead", [worker.id]: "worker", [tester.id]: "tester", [reviewer.id]: "reviewer" } });
  const brief = { goal: "Add a checked cart", inScope: ["cart.txt"], outOfScope: ["payments"], acceptance: ["node check.cjs passes"], constraints: ["Do not touch setup.cjs"], openQuestions: [],
    structure: [{ name: "cart", paths: ["cart.txt"], owns: "the cart" }, { name: "scripts", paths: ["setup.cjs", "check.cjs"], owns: "project scripts", readOnly: true }] };
  writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({
    [lead.id]: { turns: [{ reply: envelope({ status: "continue", brief, tasks: [{ id: "cart", assignee: worker.id, instruction: "Create cart.txt", writes: ["cart.txt"] }] }) }, { reply: envelope({ status: "completed", detail: "Cart built, tested and reviewed" }) }] },
    [worker.id]: { writeFiles: { "cart.txt": "cart\n" }, reply: "Cart built." },
    [tester.id]: { reply: "VERDICT: PASS" }, [reviewer.id]: { reply: "REVIEW: CLEAR" },
  }));
  browser = await neonBrowser(join(fixture.info.dataDir, "chrome-profile"), process.env.AGENT_BROWSER_EXECUTABLE_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe");
  preview = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__goal-record.html", title: "Isolated goal record verification", logLevel: "warn" });
  console.log(JSON.stringify({ fixture: fixture.info, preview: preview.previewUrl, evidence }));
  await browser(["set", "viewport", "1366", "768"]);
  await browser(["open", preview.previewUrl]);
  await waitFor("Boolean(document.querySelector('[data-office-nav]'))");
  await evaluate("localStorage.setItem('omb-skin','neon'); location.reload(); true");
  await waitFor("Boolean(document.querySelector('[data-office-nav]'))");
  await evaluate("document.querySelector('[data-office-nav]').click(); true");
  await waitFor("Boolean(document.querySelector('[aria-label=\"Mở room Checkout record\"]'))");
  await evaluate("document.querySelector('[aria-label=\"Mở room Checkout record\"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); true");
  await waitFor("Boolean(document.querySelector('[data-room-project-settings]'))");

  await typeInto("Chỉ dẫn dự án", "Use plain Node scripts. Keep cart.txt one line.");
  await evaluate(`(() => { const field=document.querySelector('[aria-label="Mẫu dự án"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,'web'); field.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await typeInto("Đường dẫn cần giữ nguyên", "setup.cjs");
  await evaluate("[...document.querySelectorAll('[data-room-project-settings] button')].find(button=>button.textContent.includes('Thêm')).click(); true");
  await waitFor("Boolean(document.querySelector('[aria-label=\"Lệnh setup 1\"]'))");
  await typeInto("Lệnh setup 1", "node setup.cjs");
  await waitFor(`Boolean(${projectButton("Lưu hồ sơ")}) && !${projectButton("Lưu hồ sơ")}.disabled`);
  await evaluate(`${projectButton("Lưu hồ sơ")}.click(); true`);
  await waitFor("document.querySelector('[data-room-project-settings]').textContent.includes('Đã lưu hồ sơ dự án.')");
  const saved = (await roomOf(api, room.id)).projectProfile;
  assert.deepEqual(saved, { template: "web", instructions: "Use plain Node scripts. Keep cart.txt one line.", protectedPaths: ["setup.cjs"], setup: [{ id: "setup-1", command: "node setup.cjs", timeoutSec: 120, expectExit: 0 }] });
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await browser(["set", "viewport", String(width), String(height)]);
    await evaluate(`document.querySelector('[aria-label="Mẫu dự án"]').scrollIntoView({block:'center'}); true`);
    assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth+1"), false, `project settings overflow at ${width}`);
    await browser(["screenshot", join(evidence, `project-template-${width}.png`)]);
  }
  await browser(["set", "viewport", "1366", "768"]);
  await evaluate("document.querySelector('[data-room-project-settings]').scrollIntoView({block:'start'}); true");
  await browser(["screenshot", join(evidence, "project-settings.png")]);
  await evaluate("document.querySelector('[data-room-panel] > div:first-child > button:last-child').click(); true");
  await waitFor("!document.querySelector('[data-room-panel]')");

  await api("POST", `/api/groups/${room.id}/messages`, { text: "Add a checked cart", mode: "goal" });
  const wait = await runControlOmb(["wait", "--channel", room.id, "--task", room.threadId, "--timeout", "60", "--url", fixture.info.url]);
  const completed = (await api("GET", `/api/threads/${room.threadId}/messages`)).messages.find((message: any) => message.goalRun)?.goalRun;
  writeFileSync(join(evidence, "goal.json"), JSON.stringify(completed, null, 2));
  assert.equal(completed?.status, "completed", completed?.detail);
  assert.deepEqual(completed.brief, brief);
  const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
  const instructions = `${JSON.stringify(dump.prompt)}\n${dump.systemPrompt}`;
  assert.ok(instructions.includes("Project template: Web full-stack"));
  assert.ok(instructions.includes("Lead playbook:"));
  assert.deepEqual(completed.baseline.setup.map((check: any) => [check.id, check.exitCode]), [["setup-1", 0]]);
  assert.deepEqual(completed.baseline.checks.map((check: any) => [check.id, check.exitCode]), [["cart", 1]]);
  assert.equal(readFileSync(join(project, "ready.txt"), "utf8"), "ready\n");

  await waitFor("document.querySelector('[data-goal-run-flags]')?.textContent === 'gốc 1 lệnh lỗi'");
  await evaluate("document.querySelector('[data-goal-run-card]').click(); true");
  await waitFor("Boolean(document.querySelector('[data-goal-run-panel] [data-goal-brief]'))");
  const panel = await evaluate(`(() => { const p=document.querySelector('[data-goal-run-panel]'); return {
    brief:p.querySelector('[data-goal-brief]').textContent,
    lists:[...p.querySelectorAll('[data-goal-brief-list]')].map(el=>el.dataset.goalBriefList),
    areas:[...p.querySelectorAll('[data-goal-area]')].map(el=>[el.dataset.goalArea,el.dataset.readOnly]),
    baseline:p.querySelector('[data-goal-baseline]').textContent,
    checks:[...p.querySelectorAll('[data-goal-check]')].map(el=>[el.dataset.goalCheck,el.dataset.passed]),
    conflicts:Boolean(p.querySelector('[data-goal-conflicts]')) }; })()`);
  assert.ok(panel.brief.includes("Add a checked cart") && panel.brief.includes("node check.cjs passes"));
  assert.deepEqual(panel.lists, ["Trong phạm vi", "Ngoài phạm vi", "Tiêu chí nghiệm thu", "Ràng buộc"]);
  assert.deepEqual(panel.areas, [["cart", "false"], ["scripts", "true"]]);
  assert.ok(panel.baseline.includes("1/2 lệnh đạt"));
  assert.deepEqual(panel.checks, [["setup-1", "true"], ["cart", "false"]]);
  assert.equal(panel.conflicts, false);
  await evaluate("document.querySelector('[data-goal-check=\"cart\"] details').open=true; true");
  const bounds = [];
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await browser(["set", "viewport", String(width), String(height)]);
    await evaluate("document.querySelector('[data-goal-baseline]').scrollIntoView({block:'center'}); document.fonts.ready.then(()=>true)");
    await new Promise((done) => setTimeout(done, 400));
    const measured = await evaluate("({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,panelOverflow:(()=>{const p=document.querySelector('[data-goal-run-panel]');return [...p.querySelectorAll('*')].some(el=>el.getBoundingClientRect().right>p.getBoundingClientRect().right+1)})()})");
    assert.equal(measured.overflow, false, `page overflow at ${width}`);
    assert.equal(measured.panelOverflow, false, `panel overflow at ${width}`);
    bounds.push(measured);
    await browser(["screenshot", join(evidence, `goal-panel-${width}.png`)]);
  }
  await browser(["set", "viewport", "1366", "768"]);
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); true");
  await waitFor("!document.querySelector('[data-goal-run-panel]')");

  await evaluate("document.querySelector('[data-room-name]').click(); true");
  await waitFor(`Boolean(${projectButton("Xoá hồ sơ")})`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Mẫu dự án"]').value`), "web");
  await evaluate(`(() => { const field=document.querySelector('[aria-label="Mẫu dự án"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,''); field.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await waitFor(`!${projectButton("Lưu hồ sơ")}.disabled`);
  await evaluate(`${projectButton("Lưu hồ sơ")}.click(); true`);
  await waitFor("document.querySelector('[data-room-project-settings]').textContent.includes('Đã lưu hồ sơ dự án.')");
  const { template: _, ...withoutTemplate } = saved;
  assert.deepEqual((await roomOf(api, room.id)).projectProfile, withoutTemplate);
  await evaluate(`${projectButton("Xoá hồ sơ")}.click(); true`);
  await waitFor("document.querySelector('[data-room-project-settings]').textContent.includes('Đã xoá hồ sơ dự án.')");
  assert.equal((await roomOf(api, room.id)).projectProfile, null);
  assert.equal(await evaluate(`Boolean(${projectButton("Xoá hồ sơ")})`), false);
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Chỉ dẫn dự án\"]').value"), "");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Mẫu dự án"]').value`), "");
  const kept = (await api("GET", `/api/threads/${room.threadId}/messages`)).messages.find((message: any) => message.goalRun)?.goalRun;
  assert.deepEqual(kept.baseline, completed.baseline);

  const consoleLog = await browser(["console"]);
  assert.equal(consoleLog.logs.filter((entry: any) => entry.type === "error").length, 0);
  writeFileSync(join(evidence, "result.json"), JSON.stringify({ ok: true, fixture: fixture.info, bounds, saved, wait, consoleLog }, null, 2));
  console.log(JSON.stringify({ ok: true, evidence, bounds }));
} finally {
  await browser?.(["close"]).catch(() => {});
  await preview?.close();
  await fixture.close();
}
