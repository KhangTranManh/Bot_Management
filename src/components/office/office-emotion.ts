import type { MausState } from "@/lib/mascot";
import type { MemberNow } from "../../../shared/room-now";
import type { OfficeState } from "./office-model";

/** How long a bot keeps the "just got the job" and "just handed it in" faces. */
export const RECEIVE_MS = 3_000;
export const SEND_MS = 3_000;
/** A running job with no new step for this long looks drowsy; an idle bot falls asleep after SLEEP_MS. */
export const DROWSY_MS = 120_000;
export const SLEEP_MS = 600_000;
/** A goal that just completed makes its whole room celebrate for this long. */
export const CELEBRATE_MS = 8_000;
/** A face stays at least this long, so a 5 s poll never flickers between two of them. */
export const HOLD_MS = 1_500;

export type StepKind = "read" | "write" | "run";

/** What the newest step of a job is doing, read from its label; undefined when it names no tool. The label is the
 * engine's own wording, so this is a reading of words, not a field. */
export function stepKind(step: string | undefined): StepKind | undefined {
  const text = step?.trim().toLowerCase();
  if (!text) return undefined;
  if (/\b(edit|write|patch|create|apply|multiedit|notebookedit|replace)\b/.test(text)) return "write";
  if (/\b(read|grep|glob|search|find|list|ls|cat|fetch|open|view|look)\b/.test(text)) return "read";
  return "run";
}

export interface EmotionInput {
  state: OfficeState;
  job?: Pick<MemberNow, "step" | "stepOk">;
  /** Milliseconds since this bot's job first showed up as running. */
  sinceReceived?: number;
  /** Milliseconds since this bot's running job ended. */
  sinceFinished?: number;
  /** Milliseconds since the newest step of the running job changed. */
  stepIdleMs?: number;
  /** Milliseconds this bot has been seen idle. */
  idleMs?: number;
  celebrating?: boolean;
}

/** The face a bot wears, from what it is doing. The first line that fits wins. */
export function officeEmotion(input: EmotionInput): MausState {
  const { state, job, sinceReceived, sinceFinished, stepIdleMs, idleMs, celebrating } = input;
  if (celebrating) return "celebrate";
  if (state === "waiting") return "alerting";
  if (state === "out") return "sad";
  if (state === "queued") return "listening";
  if (state === "running") {
    if (job?.stepOk === false) return "confused";
    if (sinceReceived !== undefined && sinceReceived < RECEIVE_MS) return "receiving";
    if (stepIdleMs !== undefined && stepIdleMs > DROWSY_MS) return "drowsy";
    const kind = stepKind(job?.step);
    if (kind === "write") return "writing";
    if (kind === "read") return "searching";
    if (kind === "run") return "working";
    return "thinking";
  }
  if (sinceFinished !== undefined && sinceFinished < SEND_MS) return "sending";
  if (idleMs !== undefined && idleMs > SLEEP_MS) return "sleeping";
  return "idle";
}
