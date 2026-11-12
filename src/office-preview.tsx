// Dev-only gallery of the office floor, served at /office-preview.html; not in the packaged app.
// ?scene=rest|work|queue|done|mixed|faces  (default mixed); faces shows every face an office bot can wear
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Bot, Group } from "@/state/store";
import type { MemberNow } from "../shared/room-now";
import { BotAvatar } from "@/components/Avatar";
import { OfficeBadge } from "@/components/office/OfficeBadge";
import { OfficeScene } from "@/components/office/OfficeScene";
import "./styles.css";

document.documentElement.dataset.skin = "neon";
const scene = new URLSearchParams(location.search).get("scene") ?? "mixed";

const bot = (id: string, name: string, color: Bot["color"], mascotBody: string, over: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false,
  messages: [], modelSelection: { instanceId: "claude", model: "claude-sonnet-5" }, mascotBody, ...over,
} as Bot);
const bots = [
  bot("chief", "Fixture Starter", "pink", "star", { chiefOfStaff: true }),
  bot("lead", "Lead", "blue", "cursor"), bot("terra", "Terra", "teal", "blob"), bot("luna", "Luna", "orange", "drop"), bot("tester", "Tester", "green", "hexagon"),
  bot("a", "Wren", "purple", "capsule"), bot("b", "Rio", "yellow", "squircle"),
];
const room = (over: Partial<Group>): Group => ({
  id: "g", threadId: "g-thread", name: "Room", description: "", memberIds: [], defaultResponder: { kind: "mentions" }, bulletin: "",
  unread: false, createdAt: 1, setupCompletedAt: 1, messages: [], ...over,
} as Group);
const code = room({ id: "code", name: "Inventory service", kind: "code", memberIds: ["lead", "terra", "luna", "tester"], roles: { lead: "lead", terra: "worker", luna: "worker", tester: "tester" } });
const research = room({ id: "res", name: "CPU research", kind: "research", memberIds: ["a", "b"] });
const job = (botId: string, over: Partial<MemberNow>): MemberNow => ({ botId, state: "running", task: "Build the cart module", threadId: `lane-${botId}`, since: Date.now() - 42_000, ...over });

const JOBS: Record<string, Record<string, MemberNow[]>> = {
  rest: { code: [], res: [] },
  work: { code: [job("lead", { task: "Plan the inventory work" }), job("terra", { task: "Fix cart totals", step: "Edit: src/cart.js" }), job("luna", { task: "Fix stock counts", step: "Read: src/stock.js" })], res: [] },
  queue: { code: [job("terra", { step: "npm test" }), job("tester", { state: "queued", task: "Run the suite" })], res: [] },
  done: { code: [], res: [] },
  mixed: { code: [job("terra", { task: "Fix cart totals", step: "Edit: src/cart.js" }), job("luna", { task: "Fix stock counts", step: "npm test", stepOk: false }), job("tester", { state: "queued", task: "Run the suite" })], res: [job("a", { task: "Tune the classifier", step: "Grep: score" })] },
};
const finished = scene === "done" ? [{ id: "c", role: "bot", kind: "goal.run", at: 1, goalRun: { runId: "r", goal: "Ship", status: "completed", coordinatorBotId: "lead", coordinatorName: "Lead", turnCount: 4, maxTurns: 13, startedAt: 1, finishedAt: Date.now() + 3_600_000 } }] : [];
const groups = [{ ...code, messages: finished } as unknown as Group, research];

const FACES = ["idle", "thinking", "searching", "writing", "working", "receiving", "sending", "listening", "confused", "drowsy", "sleeping", "alerting", "sad", "celebrate"] as const;
const faces = (
  <main className="office-page" style={{ minHeight: "100vh", padding: 24 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 20 }}>
      {FACES.map((face, n) => (
        <figure key={face} style={{ margin: 0, textAlign: "center", color: "#cfc8ee", font: "12px 'JetBrains Mono', monospace" }}>
          <div style={{ position: "relative", display: "inline-block", ["--state" as string]: "#3dffa2" }}>
            <BotAvatar bot={bots[1 + (n % 6)]!} size={96} state={face} animated={false} label={face} />
            <svg width="40" height="40" viewBox="-20 -20 40 40" style={{ position: "absolute", right: -26, top: -22 }}><OfficeBadge face={face} at={[-21, 21]} /></svg>
          </div>
          <figcaption>{face}</figcaption>
        </figure>
      ))}
    </div>
  </main>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {scene === "faces" ? faces : (
      <main className="office-page" style={{ minHeight: "100vh" }}>
        <section className="office-stage"><OfficeScene groups={groups} bots={bots} jobs={JOBS[scene] ?? JOBS.mixed!} select={() => {}} openRoom={() => {}} /></section>
      </main>
    )}
  </StrictMode>,
);
