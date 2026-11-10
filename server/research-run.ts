import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { VerifyCommand } from "../shared/wire.ts";
import type { MetricReading } from "./research-goal.ts";
import {
  appendResearchLedger,
  heldOutMentions,
  loadResearchGoal,
  readResearchMetric,
  researchHistory,
  researchLedgerPath,
} from "./research-goal.ts";
import type { ResearchRunRules } from "./group-goal-run.ts";
import type { VerifyResult } from "./verify-run.ts";

export interface ResearchRoomInput {
  groupId: string;
  goalFile?: string;
  goalFileHash?: string;
  /** The folder the goal thread runs in; undefined when the room has none. */
  folder: string | undefined;
  runId: string;
  dataDir: string;
  eventsDir: string;
  members: ReadonlyArray<{ id: string; name: string; chiefOfStaff?: boolean }>;
  /** The threads a member worked in during this goal run: the goal thread and its own lanes. */
  memberThreads(botId: string): string[];
  /** The engine instance a member runs on, to tell its tool calls apart in a shared thread. */
  instanceOf(botId: string): string | undefined;
}

export interface ResearchRunWiring {
  verify: VerifyCommand[];
  research: ResearchRunRules;
  missingHandoffFiles(): Promise<string[]>;
  heldOutTouched(botId: string, sinceMs: number): Promise<string[]>;
  readMetric(): Promise<MetricReading>;
  recordMetric(value: number): void;
  recordVerify(result: VerifyResult): void;
  recordEnd(status: string, detail: string): void;
}

export type ResearchRunSetup =
  | { ok: false; status: "needs-input" | "blocked"; detail: string }
  | { ok: true; wiring: ResearchRunWiring };

/** A research room never starts a goal softly: a folder, no Chief of Staff in the room, and an approved goal
 * file whose bytes still match the locked hash. */
export function prepareResearchRun(input: ResearchRoomInput): ResearchRunSetup {
  const { folder } = input;
  if (!folder) return { ok: false, status: "needs-input", detail: "This research room needs a working folder before its goal file can be checked." };
  const chief = input.members.find((member) => member.chiefOfStaff);
  if (chief) {
    return { ok: false, status: "needs-input", detail: `${chief.name} is a Chief of Staff, whose lift would raise teammates' access in a research room. Remove it from the room, then send the goal again.` };
  }
  const loaded = input.goalFile ? loadResearchGoal(join(folder, input.goalFile)) : { ok: false as const, error: "this research room has no goal file set (goalFile)" };
  if (!loaded.ok) {
    return { ok: false, status: "needs-input", detail: `${loaded.error}. Set goalFile on the room, then approve it with PATCH { "researchGoalApprove": true }.` };
  }
  if (input.goalFileHash && input.goalFileHash !== loaded.hash) {
    return { ok: false, status: "blocked", detail: "The research goal file changed after it was approved (preregistration lock). Restore the approved version or approve the new one." };
  }
  if (!input.goalFileHash) {
    return { ok: false, status: "needs-input", detail: `Approve the research goal file before any run (sha256 ${loaded.hash.slice(0, 16)}…): PATCH the room with { "researchGoalApprove": true }.` };
  }
  const goal = loaded.goal;
  const ledger = researchLedgerPath(input.dataDir, input.groupId);
  const history = researchHistory(ledger, loaded.hash);
  try {
    appendResearchLedger(ledger, { runId: input.runId, kind: "run-start", goal: goal.name, hash: loaded.hash });
  } catch (error) {
    return { ok: false, status: "blocked", detail: `The research ledger cannot be written (${ledger}): ${error instanceof Error ? error.message : String(error)}. The budget cannot be guarded without it.` };
  }
  // The run-start line proved the ledger writable; a later write that fails loses one record, never the run.
  const write = (entry: Record<string, unknown>) => {
    try {
      appendResearchLedger(ledger, { runId: input.runId, ...entry });
    } catch {}
  };
  return {
    ok: true,
    wiring: {
      verify: goal.verify,
      research: {
        budgetWallMinutes: goal.budget.wallMinutes,
        budgetSpentMs: history.spentMs,
        pilotMaxTasks: goal.pilot?.maxTasks,
        handoffExpectsFiles: goal.handoff?.expectsFiles,
        heldOutPaths: goal.heldOutPaths,
        metric: { threshold: goal.metric.threshold, direction: goal.metric.direction },
        maxExperimentRounds: goal.maxExperimentRounds,
        stopAfterFlatRounds: goal.stopAfterFlatRounds,
        priorMetricValues: history.metricValues,
      },
      missingHandoffFiles: async () => (goal.handoff?.expectsFiles ?? []).filter((file) => !existsSync(join(folder, file))),
      heldOutTouched: async (botId, sinceMs) => {
        const paths = goal.heldOutPaths ?? [];
        if (!paths.length) return [];
        const found = new Set<string>();
        for (const threadId of input.memberThreads(botId)) {
          let raw = "";
          try {
            raw = readFileSync(join(input.eventsDir, `${threadId}.ndjson`), "utf8");
          } catch {
            continue;
          }
          for (const path of heldOutMentions(raw, paths, sinceMs, input.instanceOf(botId))) found.add(path);
        }
        return [...found];
      },
      readMetric: async () => readResearchMetric(folder, goal),
      recordMetric: (value) => write({ kind: "metric", hash: loaded.hash, value }),
      recordVerify: (result) => write({ kind: "verify", id: result.id, exitCode: result.exitCode }),
      recordEnd: (status, detail) => write({ kind: "run-end", status, detail: detail.slice(0, 200) }),
    },
  };
}
