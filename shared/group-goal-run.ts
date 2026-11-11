import type { ServerTextParams } from "./server-text.ts";
import type { GoalBranchCard } from "./goal-branches.ts";
/** Durable progress receipt for one goal-driven channel run. */
export type GroupGoalRunStatus =
  | "working"
  | "completed"
  | "needs-input"
  | "blocked"
  | "limit-reached"
  /** The operator (or a guard) parked the run. */
  | "paused"
  | "stopped"
  | "failed";

/** What the run is held to, written by the Lead in its first plan from the goal and the conversation before it. */
export interface GoalBrief {
  goal: string;
  inScope: string[];
  outOfScope: string[];
  /** Checks the Tester and Reviewer are given with the Lead's plan. */
  acceptance: string[];
  constraints: string[];
  /** Questions the person answers before any work starts; any entry stops the run at needs-input. */
  openQuestions: string[];
}

/** A Worker's edit to a file another Worker's task owns, seen while their wave ran. */
export interface GoalConflict {
  file: string;
  /** The task whose writes name the file, else the first Worker that edited it. */
  ownerTask: string;
  ownerBotId: string;
  ownerName: string;
  otherTask: string;
  otherBotId: string;
  otherName: string;
  /** The other Worker's running turn was told to stop editing the file. */
  steered: boolean;
  at: number;
}

/** A server-run command's bounded, redacted result, independent of any bot's verdict. */
export interface GoalCheckResult {
  id: string;
  /** Null when the command could not start or was killed. */
  exitCode: number | null;
  expectExit: number;
  output: string;
}

/** Project preparation and check results taken before the first bot turn of this goal. */
export interface GoalBaseline {
  startedAt: number;
  finishedAt: number;
  setup: GoalCheckResult[];
  checks: GoalCheckResult[];
}

export interface GroupGoalRunCardData {
  runId: string;
  goal: string;
  status: GroupGoalRunStatus;
  coordinatorBotId: string;
  coordinatorName: string;
  turnCount: number;
  maxTurns: number;
  detail?: string;
  /** Fixed detail words, used only while they reconstruct the stored English. */
  detailCode?: string;
  detailParams?: ServerTextParams;
  startedAt: number;
  finishedAt?: number;
  brief?: GoalBrief;
  baseline?: GoalBaseline;
  branches?: GoalBranchCard;
  /** The latest conflicts of the run, oldest first. */
  conflicts?: GoalConflict[];
}
