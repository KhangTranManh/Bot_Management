import type { TeamRole } from "../shared/team-roles.ts";
import type { LeadTaskPlan } from "./lead-schedule.ts";
import { UNKNOWN_VENDOR } from "./model-vendor.ts";
import { pathDeclared } from "./writes-audit.ts";

/** A Tester's reply ends with this line; the last one counts. */
const VERDICT = /VERDICT:\s*(PASS|FAIL)\b/gi;

export const TEAM_MAX_FIX_ROUNDS = 3;

export type TeamVerdict = "pass" | "fail";

export function testerVerdict(reply: string): TeamVerdict | undefined {
  const last = [...reply.matchAll(VERDICT)].at(-1);
  return last ? (last[1]!.toUpperCase() === "PASS" ? "pass" : "fail") : undefined;
}

/** A Tester names each failure on its own line: `FAIL: <file or test> — <error>`. */
const TEST_FAILURE = /^[ \t]*FAIL:[ \t]*(\S+)/gim;
/** A Reviewer writes each finding on its own line: `FINDING: <block|fix|note> <task id> <file>:<line> — <problem>`. */
const FINDING = /^[ \t]*FINDING:[ \t]*(block|fix|note)\b[ \t]*(.*)$/gim;
/** A Reviewer's reply ends with `REVIEW: CLEAR` or `REVIEW: BLOCK <count>`; the last one counts. */
const REVIEW_END = /REVIEW:[ \t]*(CLEAR|BLOCK)\b/gi;

export type FindingLevel = "block" | "fix" | "note";

export interface ReviewFinding {
  level: FindingLevel;
  task?: string;
  file?: string;
  text: string;
}

export interface ReviewReport {
  /** Undefined when the reply has no closing REVIEW line. */
  end?: "clear" | "block";
  findings: ReviewFinding[];
  /** A block finding or a closing REVIEW: BLOCK holds the goal until the Lead deals with it. */
  blocking: boolean;
}

const sourcePath = (reference: string): string => reference.replace(/[,;.]+$/, "").replace(/(:\d+){1,2}$/, "");
const looksLikePath = (token: string): boolean => /[/\\.]/.test(token);

export function testerFailures(reply: string): string[] {
  return [...new Set([...reply.matchAll(TEST_FAILURE)].map((match) => sourcePath(match[1]!)))];
}

export function reviewReport(reply: string): ReviewReport {
  const findings = [...reply.matchAll(FINDING)].map((match): ReviewFinding => {
    const [head = "", ...rest] = match[2]!.split(/\s+[—–-]\s+/);
    const tokens = rest.length ? head.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    const file = tokens.find(looksLikePath);
    const task = tokens.find((token) => token !== file);
    return {
      level: match[1]!.toLowerCase() as FindingLevel,
      ...(task ? { task } : {}),
      ...(file ? { file: sourcePath(file) } : {}),
      text: (rest.length ? rest.join(" - ") : match[2]!).trim(),
    };
  });
  const last = [...reply.matchAll(REVIEW_END)].at(-1);
  const end = last ? (last[1]!.toUpperCase() === "CLEAR" ? "clear" as const : "block" as const) : undefined;
  return { ...(end ? { end } : {}), findings, blocking: end === "block" || findings.some((finding) => finding.level === "block") };
}

/** The Worker task a failure or finding belongs to: the named task id first, else the task whose writes name the file. */
export function owningTask<Task extends { id: string; writes?: readonly string[] }>(tasks: readonly Task[], file?: string, taskId?: string): Task | undefined {
  return tasks.find((task) => taskId !== undefined && task.id === taskId)
    ?? (file ? tasks.find((task) => (task.writes?.length ? pathDeclared(file, task.writes) : false)) : undefined);
}

/** Why a plan breaks the room's roles: work only to Workers, each declaring what it writes; tests to Testers and
 * review to Reviewers, who change no files; nothing to the Lead or to a member without a role. */
export function teamPlanProblem(tasks: ReadonlyArray<{ plan: LeadTaskPlan; botId: string; name: string }>, roleOf: (botId: string) => TeamRole | undefined): string | undefined {
  for (const { plan, botId, name } of tasks) {
    const role = roleOf(botId);
    if (role === undefined || role === "lead") return `task ${plan.id} goes to ${name}, who is ${role === "lead" ? "the Lead" : "not given a team role"}; give tasks only to Workers, Testers and Reviewers`;
    if (role === "worker" && !plan.writes?.length) return `task ${plan.id} for Worker ${name} declares no writes; list the files or artifacts it changes`;
    if ((role === "tester" || role === "reviewer") && plan.writes?.length) {
      return `task ${plan.id} for ${role === "tester" ? "Tester" : "Reviewer"} ${name} declares writes (${plan.writes.slice(0, 3).join(", ")}); Testers and Reviewers change no files, so give writing code or tests to a Worker`;
    }
  }
  return undefined;
}

/** Why a plan breaks the vendor rule: a Reviewer's or Evaluator's model vendor must differ from every
 * Worker's in the plan or earlier in the run; "unknown" is never treated as different. */
export function teamVendorProblem(
  tasks: ReadonlyArray<{ plan: LeadTaskPlan; botId: string; name: string }>,
  roleOf: (botId: string) => TeamRole | undefined,
  vendorOf: (botId: string) => string | undefined,
  earlierWorkers: ReadonlyArray<{ botId: string; name: string }> = [],
): string | undefined {
  const planned = tasks.filter(({ botId }) => roleOf(botId) === "worker");
  const workers = [...planned, ...earlierWorkers.filter(({ botId }) => !planned.some((task) => task.botId === botId))];
  for (const { plan, botId, name } of tasks) {
    const role = roleOf(botId);
    if (role !== "reviewer" && role !== "evaluator") continue;
    const checkVendor = vendorOf(botId);
    for (const worker of workers) {
      const workerVendor = vendorOf(worker.botId);
      if (checkVendor === undefined || workerVendor === undefined || checkVendor === UNKNOWN_VENDOR || workerVendor === UNKNOWN_VENDOR) {
        return `task ${plan.id} for ${role === "evaluator" ? "Evaluator" : "Reviewer"} ${name} runs on an unknown model vendor; pick engines whose vendor is known so it differs from the Workers`;
      }
      if (checkVendor === workerVendor) return `task ${plan.id} for ${role === "evaluator" ? "Evaluator" : "Reviewer"} ${name} runs on the same model vendor (${checkVendor}) as Worker ${worker.name}; it must run a different vendor than the work it judges`;
    }
  }
  return undefined;
}

type AssigneeRole = (assignee: string) => TeamRole | undefined;
type AssigneeName = (assignee: string) => string | undefined;

const PLAN_LINE_CHARS = 160;

/** The Lead's plan as a check task reads it: one line per Worker task with its id, Worker, what it does and its files. */
export function workPlan(work: readonly LeadTaskPlan[], nameOf: AssigneeName): string {
  return work.map((task) => {
    const what = task.instruction.replace(/\s+/g, " ").trim();
    const short = what.length > PLAN_LINE_CHARS ? `${what.slice(0, PLAN_LINE_CHARS - 1)}…` : what;
    return `- ${task.id} · ${nameOf(task.assignee) ?? task.assignee} · ${short} · ${task.writes?.join(", ") || "no declared files"}`;
  }).join("\n");
}

/** What a check task is told besides the plan: Worker names for the assignees, and the brief's acceptance checks. */
export interface CheckContext {
  nameOf?: AssigneeName;
  acceptance?: readonly string[];
}

/** One check task waits on all of a plan's Worker tasks unless the Lead wrote its own; either way every check task of
 * that role carries the Lead's plan and the acceptance checks. */
function withCheckTask(plan: readonly LeadTaskPlan[], roleOf: AssigneeRole, context: CheckContext, check: {
  role: TeamRole; member: { id: string } | undefined; baseId: string; label: string; heading: string; instruction(ids: string): string;
}): LeadTaskPlan[] {
  const work = plan.filter((task) => roleOf(task.assignee) === "worker");
  if (!check.member || !work.length) return [...plan];
  const acceptance = context.acceptance?.length ? `\nAcceptance checks from the run's brief:\n${context.acceptance.map((entry) => `- ${entry}`).join("\n")}` : "";
  const planNote = `\n${check.heading}\n${workPlan(work, context.nameOf ?? (() => undefined))}${acceptance}`;
  if (plan.some((task) => roleOf(task.assignee) === check.role)) {
    return plan.map((task) => (roleOf(task.assignee) === check.role ? { ...task, instruction: `${task.instruction}${planNote}` } : task));
  }
  const ids = new Set(plan.map((task) => task.id));
  let id = check.baseId;
  for (let n = 2; ids.has(id); n++) id = `${check.baseId}-${n}`;
  return [...plan, {
    id,
    assignee: check.member.id,
    role: check.label,
    instruction: `${check.instruction(work.map((task) => task.id).join(", "))}${planNote}`,
    reads: [...new Set(work.flatMap((task) => task.writes ?? []))],
    dependsOn: work.map((task) => task.id),
  }];
}

export function withTesterTask(plan: readonly LeadTaskPlan[], roleOf: AssigneeRole, tester: { id: string } | undefined, context: CheckContext = {}): LeadTaskPlan[] {
  return withCheckTask(plan, roleOf, context, {
    role: "tester", member: tester, baseId: "test", label: "Tester",
    heading: "The Lead's plan for the work you test (task · Worker · what it does · files):",
    instruction: (ids) => `Test the changes from ${ids}: run the build and the tests, check the behaviour each task asked for, and report each failure with its error.`,
  });
}

export function withReviewTask(plan: readonly LeadTaskPlan[], roleOf: AssigneeRole, reviewer: { id: string } | undefined, context: CheckContext = {}): LeadTaskPlan[] {
  return withCheckTask(plan, roleOf, context, {
    role: "reviewer", member: reviewer, baseId: "review", label: "Reviewer",
    heading: "The Lead's plan for the work you review (task · Worker · what it does · files); name the task id in each finding:",
    instruction: (ids) => `Review the changes from ${ids}: read each task's files for correctness, edge cases and regressions. Do not repeat the Tester's build and test runs.`,
  });
}

/** What each role is told on top of its assignment. */
export function teamRoleRule(role: TeamRole | undefined): string | undefined {
  if (role === "tester") {
    return "You are this room's Tester: change no source files. Run the checks and write each failure on its own line as FAIL: <file or test> — <error>. " +
      "End your reply with exactly one line: VERDICT: PASS or VERDICT: FAIL.";
  }
  if (role === "reviewer") {
    return "You are this room's Reviewer: read and review only, change no files. Write each problem on its own line as FINDING: <block|fix|note> <task id> <file>:<line> — <problem>. " +
      "block is wrong behaviour, data loss, a security hole or a broken project rule; fix should change but meets the request; note is a remark. " +
      "End your reply with exactly one line: REVIEW: CLEAR when nothing is block, otherwise REVIEW: BLOCK <number of block findings>.";
  }
  if (role === "evaluator") return "You are this room's Evaluator: run only the evaluation steps the assignment and the goal file name, quote results as file references, and change no source files.";
  if (role === "worker") return "You are a Worker: change only the files your assignment lists, and say exactly what you changed.";
  return undefined;
}
