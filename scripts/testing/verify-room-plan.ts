import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchVerificationServer } from "../control-omb.ts";
import { fixtureApi, mountPreview } from "./preview-fixture.ts";
import { neonBrowser } from "./neon-browser.ts";

const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
const evidence = resolve(".omb-scratch/verify-evidence/room-plan");
mkdirSync(evidence, { recursive: true });
const envelope = (value: unknown) => `<openmaus-goal>${JSON.stringify(value)}</openmaus-goal>`;
let browser: Awaited<ReturnType<typeof neonBrowser>> | undefined;
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
const evaluate = async (source: string) => (await browser!(["eval", source])).result as any;
const waitFor = async (source: string) => {
  const deadline = Date.now() + 30_000;
  while (!await evaluate(source)) {
    if (Date.now() > deadline) throw new Error(`Room plan UI did not settle: ${source}`);
    await new Promise((done) => setTimeout(done, 150));
  }
};
try {
  const api = fixtureApi(fixture.info.url);
  await api("PATCH", "/api/config", { language: "vi" });
  for (const bot of (await api("GET", "/api/bots")).bots.filter((bot: any) => bot.defaultBot)) await api("PATCH", `/api/bots/${bot.id}`, { welcomed: true });
  const lead = (await api("POST", "/api/bots", { name: "Lead" })).bot;
  const room = (await api("POST", "/api/groups", { name: "Notes outline", memberIds: [lead.id], setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } } })).group;
  const outline = {
    brief: { goal: "Ship a notes app", inScope: ["notes"], outOfScope: ["sync"], acceptance: ["A note can be listed"], constraints: [], openQuestions: ["Which database?"],
      structure: [{ name: "backend", paths: ["server/"], owns: "API" }, { name: "frontend", paths: ["web/"], owns: "screens" }, { name: "tests", paths: ["tests/"], owns: "contract tests", readOnly: true }] },
    waves: [{ name: "Foundation", areas: ["backend"], deliverable: "A notes API" }, { name: "Screens", areas: ["frontend"], deliverable: "A notes list screen" }],
  };
  writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({ [lead.id]: { turns: [{ reply: `Outline ready.\n${envelope(outline)}` }] } }));
  browser = await neonBrowser(join(fixture.info.dataDir, "chrome-profile"), process.env.AGENT_BROWSER_EXECUTABLE_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe");
  preview = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__room-plan.html", title: "Isolated room plan verification", logLevel: "warn" });
  console.log(JSON.stringify({ fixture: fixture.info, preview: preview.previewUrl, evidence }));
  await browser(["set", "viewport", "1366", "768"]);
  await browser(["open", preview.previewUrl]);
  await waitFor("Boolean(document.querySelector('[data-office-nav]'))");
  await evaluate("localStorage.setItem('omb-skin','neon'); location.reload(); true");
  await waitFor("Boolean(document.querySelector('[data-office-nav]'))");
  await evaluate("document.querySelector('[data-office-nav]').click(); true");
  await waitFor("Boolean(document.querySelector('[aria-label=\"Mở room Notes outline\"]'))");
  await evaluate("document.querySelector('[aria-label=\"Mở room Notes outline\"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); true");

  await api("POST", `/api/groups/${room.id}/messages`, { text: "/plan a small notes app" });
  await waitFor("document.querySelector('[data-room-plan-card]')?.getAttribute('aria-label') === 'Bản phác thảo'");
  const card = await evaluate(`(() => { const c=document.querySelector('[data-room-plan-card]'); return { text:c.textContent, button:[...c.querySelectorAll('button')].map(b=>b.textContent), envelope:document.body.textContent.includes('openmaus-goal') }; })()`);
  for (const text of ["Ship a notes app", "backend", "(chỉ đọc)", "Foundation", "A notes list screen", "Which database?"]) assert.ok(card.text.includes(text), text);
  assert.deepEqual(card.button, ["Lưu vào hồ sơ dự án"]);
  assert.equal(card.envelope, false);
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await browser(["set", "viewport", String(width), String(height)]);
    await evaluate("document.querySelector('[data-room-plan-card]').scrollIntoView({block:'center'}); true");
    await new Promise((done) => setTimeout(done, 300));
    assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth+1"), false, `page overflow at ${width}`);
    assert.equal(await evaluate("(() => { const c=document.querySelector('[data-room-plan-card]').getBoundingClientRect(); return c.right>innerWidth+1 || c.left<-1; })()"), false, `card overflow at ${width}`);
    await browser(["screenshot", join(evidence, `plan-card-${width}.png`)]);
  }
  await browser(["set", "viewport", "1366", "768"]);
  await waitFor("[...document.querySelectorAll('[data-room-plan-card] button')].some(b=>!b.disabled)");
  await evaluate("document.querySelector('[data-room-plan-card] button').click(); true");
  await waitFor("document.querySelector('[data-room-plan-card] button')?.textContent === 'Đã lưu vào hồ sơ dự án'");
  const saved = (await api("GET", "/api/bots?messages=0")).groups.find((group: any) => group.id === room.id).projectProfile;
  assert.deepEqual(saved.plan.waves, outline.waves);
  assert.equal(await evaluate("document.querySelector('[data-room-plan-card] button').disabled"), true);

  const consoleLog = await browser(["console"]);
  assert.equal(consoleLog.logs.filter((entry: any) => entry.type === "error").length, 0);
  writeFileSync(join(evidence, "result.json"), JSON.stringify({ ok: true, fixture: fixture.info, saved, consoleLog }, null, 2));
  console.log(JSON.stringify({ ok: true, evidence }));
} finally {
  await browser?.(["close"]).catch(() => {});
  await preview?.close();
  await fixture.close();
}
