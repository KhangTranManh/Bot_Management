import type { TeamRole } from "../shared/team-roles.ts";
import type { LeadTaskPlan } from "./lead-schedule.ts";
import { UNKNOWN_VENDOR } from "./model-vendor.ts";

/** A Tester's reply ends with this line; the last one counts. */
const VERDICT = /VERDICT:\s*(PASS|FAIL)\b/gi;

export const TEAM_MAX_FIX_ROUNDS = 3;

export type TeamVerdict = "pass" | "fail";

export function testerVerdict(reply: string): TeamVerdict | undefined {
  const last = [...reply.matchAll(VERDICT)].at(-1);
  return last ? (last[1]!.toUpperCase() === "PASS" ? "pass" : "fail") : undefined;
}

/** Why a plan breaks the room's roles: work only to Workers, each declaring what it writes; tests to Testers;
 * review to Reviewers; nothing to the Lead or to a member without a role. */
export function teamPlanProblem(tasks: ReadonlyArray<{ plan: LeadTaskPlan; botId: string; name: string }>, roleOf: (botId: string) => TeamRole | undefined): string | undefined {
  for (const { plan, botId, name } of tasks) {
    const role = roleOf(botId);
    if (role === undefined || role === "lead") return `task ${plan.id} goes to ${name}, who is ${role === "lead" ? "the Lead" : "not given a team role"}; give tasks only to Workers, Testers and Reviewers`;
    if (role === "worker" && !plan.writes?.length) return `task ${plan.id} for Worker ${name} declares no writes; list the files or artifacts it changes`;
  }
  return undefined;
}

/** Why a plan breaks the vendor rule (NOTE.md B4): a Reviewer's model vendor must differ from every Worker's
 * in the same plan; "unknown" is never treated as different. */
export function teamVendorProblem(tasks: ReadonlyArray<{ plan: LeadTaskPlan; botId: string; name: string }>, roleOf: (botId: string) => TeamRole | undefined, vendorOf: (botId: string) => string | undefined): string | undefined {
  const workers = tasks.filter(({ botId }) => roleOf(botId) === "worker");
  for (const { plan, botId, name } of tasks) {
    if (roleOf(botId) !== "reviewer") continue;
    const reviewerVendor = vendorOf(botId);
    for (const worker of workers) {
      const workerVendor = vendorOf(worker.botId);
      if (reviewerVendor === undefined || workerVendor === undefined || reviewerVendor === UNKNOWN_VENDOR || workerVendor === UNKNOWN_VENDOR) {
        return `task ${plan.id} for Reviewer ${name} runs on an unknown model vendor; pick engines whose vendor is known so the reviewer differs from the Workers`;
      }
      if (reviewerVendor === workerVendor) return `task ${plan.id} for Reviewer ${name} runs on the same model vendor (${reviewerVendor}) as Worker ${worker.name}; a reviewer must run a different vendor than the work it reviews`;
    }
  }
  return undefined;
}

/** A plan with Worker tasks and no Tester task gets one Tester task that waits on all the work. */
export function withTesterTask(plan: readonly LeadTaskPlan[], roleOf: (assignee: string) => TeamRole | undefined, tester: { id: string } | undefined): LeadTaskPlan[] {
  const work = plan.filter((task) => roleOf(task.assignee) === "worker");
  if (!tester || work.length === 0 || plan.some((task) => roleOf(task.assignee) === "tester")) return [...plan];
  const ids = new Set(plan.map((task) => task.id));
  let id = "test";
  for (let n = 2; ids.has(id); n++) id = `test-${n}`;
  return [...plan, {
    id,
    assignee: tester.id,
    role: "Tester",
    instruction: `Test the changes from ${work.map((task) => task.id).join(", ")}: run the build and the tests, check the behaviour the tasks asked for, and report each failure with its error.`,
    reads: [...new Set(work.flatMap((task) => task.writes ?? []))],
    dependsOn: work.map((task) => task.id),
  }];
}

/** What each role is told on top of its assignment. */
export function teamRoleRule(role: TeamRole | undefined): string | undefined {
  if (role === "tester") return "You are this room's Tester: change no source files. Run the checks, then end your reply with exactly one line: VERDICT: PASS or VERDICT: FAIL.";
  if (role === "reviewer") return "You are this room's Reviewer: read and review only, change no files, and list concrete problems by file.";
  if (role === "worker") return "You are a Worker: change only the files your assignment lists, and say exactly what you changed.";
  return undefined;
}
