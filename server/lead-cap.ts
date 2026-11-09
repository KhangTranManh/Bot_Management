import type { ApprovalMode } from "../shared/approval-mode.ts";
import type { BotRecord } from "./store.ts";

export const LEAD_DEPT_PACKAGE_ID = "lead-dept";

/** Off unless explicitly enabled; when off, behavior is exactly as before. */
export function leadDeptCapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OMB_LEAD_DEPT_CAP === "1";
}

export function isLeadDeptBot(bot: Pick<BotRecord, "installedPackage">): boolean {
  return bot.installedPackage?.id === LEAD_DEPT_PACKAGE_ID;
}

const RANK: Partial<Record<ApprovalMode, number>> = { ask: 0, edits: 1, auto: 2, full: 3 };

/** A lead-dept worker never runs above edits, whatever a Chief's level would hand down. */
export function capLeadDeptLevel(bot: Pick<BotRecord, "installedPackage">, level: ApprovalMode, env: NodeJS.ProcessEnv = process.env): ApprovalMode {
  if (!leadDeptCapEnabled(env) || !isLeadDeptBot(bot)) return level;
  return (RANK[level] ?? 0) > 1 ? "edits" : level;
}
