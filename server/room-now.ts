import type { MemberNow } from "../shared/room-now.ts";
import type { HandoffView } from "./coordinator.ts";

const TASK_MAX = 160;
const STEP_MAX = 160;

const clip = (text: string, max: number) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

export interface RoomNowDeps {
  groupId: string;
  roomThreadId: string;
  memberIds: readonly string[];
  nodes: readonly HandoffView[];
  laneRoomThread(node: HandoffView): string | undefined;
  /** The member speaking in the room thread outside any job. */
  speaker?: { botId: string; since?: number; task: string };
  /** The newest step in a thread: a tool's line or a reply's words. */
  latest(threadId: string): { text: string; ok?: boolean } | undefined;
}

/** One row per member at work for this room thread, running before queued, newest start first. */
export function roomNow(deps: RoomNowDeps): MemberNow[] {
  const rows = new Map<string, MemberNow>();
  for (const node of deps.nodes) {
    if (node.status !== "running" && node.status !== "queued") continue;
    if (!deps.memberIds.includes(node.botId)) continue;
    const here = node.groupId === deps.groupId ? node.threadId === deps.roomThreadId : deps.laneRoomThread(node) === deps.roomThreadId;
    if (!here) continue;
    const state = node.status === "running" ? "running" : "queued";
    const known = rows.get(node.botId);
    if (known && (known.state === "running" || state === "queued")) continue;
    const step = state === "running" ? deps.latest(node.threadId) : undefined;
    rows.set(node.botId, {
      botId: node.botId, state, task: clip(node.text, TASK_MAX), threadId: node.threadId,
      ...(node.startedAt ? { since: node.startedAt } : {}),
      ...(step ? { step: clip(step.text, STEP_MAX), ...(step.ok !== undefined ? { stepOk: step.ok } : {}) } : {}),
    });
  }
  if (deps.speaker && rows.get(deps.speaker.botId)?.state !== "running") {
    const step = deps.latest(deps.roomThreadId);
    rows.set(deps.speaker.botId, {
      botId: deps.speaker.botId, state: "running", task: clip(deps.speaker.task, TASK_MAX), threadId: deps.roomThreadId,
      ...(deps.speaker.since ? { since: deps.speaker.since } : {}),
      ...(step ? { step: clip(step.text, STEP_MAX), ...(step.ok !== undefined ? { stepOk: step.ok } : {}) } : {}),
    });
  }
  return [...rows.values()].sort((a, b) => (a.state === b.state ? (b.since ?? 0) - (a.since ?? 0) : a.state === "running" ? -1 : 1));
}
