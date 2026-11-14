import type { GoalBrief } from "../shared/group-goal-run.ts";
import type { TeamRole } from "../shared/team-roles.ts";
import { goalBriefText } from "./goal-brief.ts";
import { GROUP_GOAL_CONTROL_OPEN, GROUP_GOAL_CONTROL_CLOSE, type GoalRunMember } from "./group-goal-run.ts";
import { ROLE_PLAYBOOKS } from "./playbooks/roles.ts";

/** `solo` is a room of one: the lead does the work in its own turns, and "continue" names itself for its next turn. */
export function groupGoalCoordinatorInstructions(args: {
  goal: string;
  members: GoalRunMember[];
  turn: number;
  maxTurns: number;
  remainingTurns: number;
  note?: string;
  solo?: boolean;
  tasksAllowed?: boolean;
  roles?: Readonly<Record<string, TeamRole>>;
  /** The run's brief once the Lead wrote it; absent before then, or when the run has no team roles. */
  brief?: GoalBrief;
  projectContext?: string;
  planContext?: string;
}): string {
  const active = args.members.filter((member) => !member.hidden);
  const roster = active
    .map((member) => `${member.name} (${member.id})${member.title ? ` — ${member.title}` : ""}${args.roles?.[member.id] ? ` [team role: ${args.roles[member.id]}]` : ""}`)
    .join("; ");
  const self = args.solo ? active[0] : undefined;
  return [
    self ? "You are working alone toward a bounded goal." : "You are the lead coordinator for a bounded team goal run.",
    `Goal: ${args.goal}`,
    ...(args.projectContext ? [args.projectContext] : []),
    ...(args.planContext && !args.brief ? [args.planContext] : []),
    ...(self ? [] : [`Available room members: ${roster}.`]),
    `This is ${self ? "" : "team "}turn ${args.turn} of ${args.maxTurns}; ${args.remainingTurns} turn(s) remain after this one.`,
    ...(args.note ? [`Harness note: ${args.note}`] : []),
    self
      ? "Use the conversation as the progress ledger. Do the next concrete piece of work now, then decide whether the goal is genuinely complete, needs the human, is blocked, or needs another turn."
      : "Use the conversation as the progress ledger. Decide whether the goal is genuinely complete, needs the human, is blocked, or needs one named teammate next.",
    "Do not continue merely to generate discussion. Do not claim completion unless the requested deliverable or answer is present in the conversation.",
    "Write a brief human-facing update or final answer, then end with exactly one private control envelope on its own line.",
    ...(args.roles && args.tasksAllowed && !self ? [] : [self
      ? `${GROUP_GOAL_CONTROL_OPEN}{"status":"continue","next":"${self.id}","instruction":"Your next step","detail":"Short progress note"}${GROUP_GOAL_CONTROL_CLOSE}`
      : `${GROUP_GOAL_CONTROL_OPEN}{"status":"continue","next":"Exact member id from the roster","instruction":"Concrete next assignment","detail":"Short progress note"}${GROUP_GOAL_CONTROL_CLOSE}`]),
    `Or use status "completed", "needs-input", or "blocked" with a non-empty "detail" and omit next/instruction.`,
    ...(args.tasksAllowed && !self ? [
      `When several pieces of work can move at the same time, first give each teammate you will use a role for this goal — one short line per teammate in your human-facing update (for example: "Scout — Researcher", "Miso — Implementer", "Quill — Reviewer") — then end with a plan envelope instead: ${GROUP_GOAL_CONTROL_OPEN}{"status":"continue","detail":"Short progress note","tasks":[{"id":"t1","assignee":"Exact member id from the roster","role":"Implementer","instruction":"Concrete assignment for that role","writes":["shared artifact it changes"],"dependsOn":[]}]}${GROUP_GOAL_CONTROL_CLOSE}`,
      "Plan rules: 1-8 tasks with unique ids; each task goes to an active roster member whose listed profile fits it, and its role field names that role — extend each teammate's own role, never contradict it; dependsOn lists ids from this plan only; declare reads/writes/locks when tasks share artifacts or a lock, omit them when independent — the scheduler already runs overlapping tasks in turn. Never re-dispatch work the ledger already shows as done: evaluate results first.",
    ] : []),
    ...(args.roles && !self ? [
      ...(args.tasksAllowed ? [ROLE_PLAYBOOKS.lead] : []),
      ...(args.tasksAllowed ? ["For implementation, use a tasks plan rather than next/instruction. Split independent files or modules among available Workers in the SAME plan, with explicit non-overlapping writes and no dependencies between independent tasks. Use dependsOn only for real data or implementation dependencies; keep coupled edits with one owner. Include Worker tasks followed by Tester and Reviewer tasks depending on the changed work, so the scheduler can run the checks together without another Lead turn. If only one Worker is needed, still use a one-Worker plan. Do not schedule a baseline Tester run unless the goal specifically needs one."] : []),
      "Team roles are fixed for this room: you are the Lead and do no task yourself; implementation goes only to members with team role worker, and every worker task lists its writes; testing goes to the tester, review to the reviewer.",
      "The goal is complete only after the tester has passed the latest changes; when the tester reports failures, give each fix to the worker who owns that file.",
      ...(Object.values(args.roles).includes("reviewer")
        ? ["A Reviewer's block findings are fixed through the worker who owns them, or set aside with a stated reason, before completing; fix and note findings are yours to weigh."]
        : []),
      ...(args.tasksAllowed ? [args.brief
        ? `The brief this run is held to:\n${goalBriefText(args.brief)}`
        : `Your first plan carries the run's brief, drawn from the goal and the conversation before it, as a "brief" field in the plan envelope: {"goal":"one sentence","inScope":["…"],"outOfScope":["…"],"acceptance":["observable checks the Tester and Reviewer verify"],"constraints":["…"],"openQuestions":[],"structure":[{"name":"area name","paths":["relative/folder/","file.js"],"owns":"what it holds"},{"name":"tests","paths":["tests/"],"owns":"contract tests","readOnly":true}]}. List openQuestions only when the person must answer before any work can start; then the run stops for them. ` +
          "The structure divides the project into areas that share no path (for example db, backend and frontend; or data, model, training and a read-only eval); each Worker task writes inside exactly one area, and read-only areas take no writes. " +
          "Sketch it before assigning work, and give each area to one Worker where you can."] : []),
    ] : []),
    "Never mention, quote, or explain the control envelope in your human-facing text.",
  ].join("\n");
}

export function groupGoalWorkerInstructions(args: {
  goal: string;
  coordinatorName: string;
  role?: string;
  assignment: string;
  turn: number;
  maxTurns: number;
  teamRule?: string;
  projectContext?: string;
}): string {
  return [
    `You are a specialist contributing to a bounded team goal run led by ${args.coordinatorName}.`,
    `Goal: ${args.goal}`,
    ...(args.projectContext ? [args.projectContext] : []),
    ...(args.role ? [`Your role on this run: ${args.role}. Work within that role; hand off anything else back to ${args.coordinatorName}.`] : []),
    ...(args.teamRule ? [args.teamRule] : []),
    `Your assignment: ${args.assignment}`,
    `This is team turn ${args.turn} of ${args.maxTurns}.`,
    "Do the assigned work now and put concrete results, evidence, or a clear blocker in your reply.",
    "Keep the handoff concise: list changed file paths, checks and outcomes, and unresolved findings. Refer to files for long artifacts; do not paste whole files or successful tool logs into the room. Include enough error detail for the next person to fix failures.",
    `Address your result to ${args.coordinatorName}. Do not invent a new orchestration protocol or emit an openmaus-goal control envelope.`,
  ].join("\n");
}
