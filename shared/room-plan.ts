import type { GoalBrief } from "./group-goal-run.ts";

/** Ordered planning stages; these describe work and never dispatch tasks. */
export interface PlanWave {
  name: string;
  areas: string[];
  deliverable: string;
}

/** Validated outline that can be reused beyond the conversation window. */
export interface RoomPlanDraft {
  brief: GoalBrief;
  waves: PlanWave[];
}

export interface RoomPlanCard {
  id: string;
  status: "working" | "ready" | "failed" | "stopped";
  request: string;
  coordinatorBotId: string;
  coordinatorName: string;
  startedAt: number;
  finishedAt?: number;
  detail?: string;
  draft?: RoomPlanDraft;
}

/** The outline selected when a goal starts, independently of later chat or profile edits. */
export interface GoalPlanSource {
  source: "conversation" | "profile";
  cardId?: string;
  draft: RoomPlanDraft;
  changeReason?: string;
}

export function planTextFromMessage(text: string): string | null {
  const match = /^\/plan(?:\s+([\s\S]*))?$/i.exec(text.trimStart());
  return match ? (match[1] ?? "").trim() : null;
}
