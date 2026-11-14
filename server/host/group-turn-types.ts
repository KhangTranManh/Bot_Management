import type { HostTurnResult } from "../coordinator.ts";
import type { GoalStepOutcome } from "../group-goal-run.ts";
import type { HandedRun } from "./acting-person.ts";
import type { LiveGoalRun } from "./goal-cards.ts";
import type { RoomRoundLine } from "./room-jobs.ts";

export type GroupTurnOperation = {
  id: string;
  threadId: string;
  botIds: Set<string>;
  cancelled: boolean;
  cancellation: AbortController;
  providerHandshakePending: boolean;
  queuedQueueIds?: string[];
  line?: RoomRoundLine;
  /** The person's room line this run answers (its member turns, mentions included, act for whoever wrote it), or the handed-on work it does. */
  requestMessageId?: string; handedFor?: HandedRun;
  goalRun?: LiveGoalRun;
};

export type GroupMemberTurnOutcome = GoalStepOutcome;
export type GroupTurnOrchestration = {
  cwd?: string;
  roomHandoffId?: string;
  resumed?: boolean;
  systemInstructions: string;
  turnInstructions?: string;
  liveRoster?: string;
  turnNote?: string;
  turnRestartNote?: string;
  followMentions: boolean;
  result: { replyText?: string; outcome?: GroupMemberTurnOutcome; stopReason?: string | null };
  onClaimed?: () => void;
  onTurnStarted?: (turnId: string) => void;
  coordination?: { id: string; settle: (outcome: HostTurnResult) => void };
  goalRunId?: string;
};

export type GroupMemberBotAvailability = "ready" | "busy" | "unavailable" | "cancelled" | "timed_out";
export type GroupMemberBotWaitResult = Exclude<GroupMemberBotAvailability, "busy">;
