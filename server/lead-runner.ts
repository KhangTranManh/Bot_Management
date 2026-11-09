import { appendFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { leadDeptCapEnabled } from "./lead-cap.ts";
import { parseLeadGoal, parseLeadTaskBallot, type LeadGoal, type LeadLedgerEntry, type LeadTaskBallot } from "./lead-goal.ts";
import { parseLedgerJsonl, planLeadRound, type LeadRoundPlan, type LeadRunState } from "./lead-run.ts";

export const LEAD_GOAL_FILE = "goal.json";
export const LEAD_TASKS_DIR = "tasks";
export const LEAD_LEDGER_FILE = "ledger.jsonl";

/** The whole lead-dept feature is off unless OMB_LEAD_DEPT_CAP=1, same switch as the approval cap. */
export function leadRunnerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return leadDeptCapEnabled(env);
}

export type LeadWorkspace = { goal: LeadGoal; ballots: LeadTaskBallot[] };
export type LeadLoadResult = { ok: true; workspace: LeadWorkspace } | { ok: false; error: string };

export async function readLeadWorkspace(dir: string): Promise<LeadLoadResult> {
  let goalRaw: string;
  try {
    goalRaw = await readFile(join(dir, LEAD_GOAL_FILE), "utf8");
  } catch {
    return { ok: false, error: `missing ${LEAD_GOAL_FILE} in ${dir}` };
  }
  const goal = parseLeadGoal(goalRaw);
  if (!goal.ok) return { ok: false, error: goal.error };
  let names: string[];
  try {
    names = (await readdir(join(dir, LEAD_TASKS_DIR))).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { ok: false, error: `missing ${LEAD_TASKS_DIR}/ in ${dir}` };
  }
  const ballots: LeadTaskBallot[] = [];
  for (const name of names) {
    let raw: string;
    try {
      raw = await readFile(join(dir, LEAD_TASKS_DIR, name), "utf8");
    } catch {
      return { ok: false, error: `cannot read ${LEAD_TASKS_DIR}/${name}` };
    }
    const ballot = parseLeadTaskBallot(raw);
    if (!ballot.ok) return { ok: false, error: `${name}: ${ballot.error}` };
    ballots.push(ballot.value);
  }
  return { ok: true, workspace: { goal: goal.value, ballots } };
}

export async function readLeadLedger(dir: string): Promise<LeadLedgerEntry[]> {
  let raw: string;
  try {
    raw = await readFile(join(dir, LEAD_LEDGER_FILE), "utf8");
  } catch {
    return [];
  }
  return parseLedgerJsonl(raw);
}

/** Only the Lead writes the ledger; one JSON line per round, appended. */
export async function appendLeadLedger(dir: string, entry: LeadLedgerEntry): Promise<void> {
  await appendFile(join(dir, LEAD_LEDGER_FILE), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

export type LeadPlanOnDisk = LeadRoundPlan | { action: "disabled" };

/** Autonomy-level-1 round over a real workspace: load, plan the next wave, stop on any error. */
export async function planLeadRoundOnDisk(
  dir: string,
  state: LeadRunState,
  opts: { now: number; maxWorkers: number; env?: NodeJS.ProcessEnv },
): Promise<LeadPlanOnDisk> {
  if (!leadRunnerEnabled(opts.env)) return { action: "disabled" };
  try {
    const loaded = await readLeadWorkspace(dir);
    if (!loaded.ok) return { action: "stop", reason: loaded.error };
    const ledger = await readLeadLedger(dir);
    return planLeadRound(loaded.workspace.goal, loaded.workspace.ballots, ledger, state, opts.now, opts.maxWorkers);
  } catch (error) {
    return { action: "stop", reason: error instanceof Error ? error.message : String(error) };
  }
}
