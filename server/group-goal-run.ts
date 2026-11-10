import type { ServerText } from "../shared/server-text.ts";
import { noticeFailure } from "./chat-notices.ts";
import type { GroupGoalRunStatus } from "../shared/group-goal-run.ts";
import type { GroupDefaultResponder } from "./store.ts";
import { LEAD_MAX_WAVE_SIZE, leadBallotFromPlan, leadBatchesForWave, leadWaves, type LeadTaskPlan } from "./lead-schedule.ts";
import type { TeamRole } from "../shared/team-roles.ts";
import { TEAM_MAX_FIX_ROUNDS, teamPlanProblem, teamRoleRule, testerVerdict, withTesterTask } from "./team-roles.ts";
import { engineFailureKind } from "./drivers/engine-errors.ts";

// Odd so the final bounded turn always falls to the coordinator for the completion decision.
export const GROUP_GOAL_MAX_TURNS = 13;
export const GROUP_GOAL_WAIT_MAX_MS = Math.max(1_000, Number(process.env.OMB_GOAL_WAIT_MAX_MS) || 30 * 60_000);
const GROUP_GOAL_MAX_WAIT_EXHAUSTIONS = 3;
export const GROUP_GOAL_CONTROL_OPEN = "<openmaus-goal>";
export const GROUP_GOAL_CONTROL_CLOSE = "</openmaus-goal>";

export type GroupGoalDecision =
  | { status: "continue"; next: string; instruction: string; detail?: string }
  | { status: "continue"; tasks: LeadTaskPlan[]; detail?: string }
  | { status: "completed" | "needs-input" | "blocked"; detail: string };

export interface GoalRunMember {
  id: string;
  name: string;
  /** The member's own profile role and blurb, so the coordinator assigns plan roles that fit. */
  title?: string;
  description?: string;
  hidden?: boolean;
  chiefOfStaff?: boolean;
}

export interface ParsedGroupGoalDecision {
  visibleText: string;
  decision: GroupGoalDecision | null;
}

export function groupGoalCompletionTurnId(
  eventTurnId: string | undefined,
  boundTurnId: string | undefined,
): string | undefined {
  return eventTurnId ?? boundTurnId;
}

const bounded = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const GROUP_GOAL_MAX_TASKS = 8;
const GROUP_GOAL_TASK_FIELD_MAX = 120;
const GROUP_GOAL_TASK_LIST_MAX = 8;

/** Every list entry must be a non-empty string; a missing list is empty, an invalid one fails the plan. */
function boundedList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > GROUP_GOAL_TASK_LIST_MAX) return null;
  const out: string[] = [];
  for (const item of value) {
    const entry = bounded(item, GROUP_GOAL_TASK_FIELD_MAX);
    if (!entry) return null;
    out.push(entry);
  }
  return out;
}

function parseGoalTasks(raw: unknown): LeadTaskPlan[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > GROUP_GOAL_MAX_TASKS) return null;
  const plans: Array<LeadTaskPlan & { reads: string[]; writes: string[]; locks: string[]; dependsOn: string[] }> = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    const id = bounded(record.id, 100);
    const assignee = bounded(record.assignee, 100);
    const role = bounded(record.role, 100);
    const instruction = bounded(record.instruction, 2_000);
    const reads = boundedList(record.reads);
    const writes = boundedList(record.writes);
    const locks = boundedList(record.locks);
    const dependsOn = boundedList(record.dependsOn);
    if (!id || !assignee || !instruction || !reads || !writes || !locks || !dependsOn) return null;
    plans.push({ id, assignee, ...(role ? { role } : {}), instruction, reads, writes, locks, dependsOn });
  }
  const ids = new Set(plans.map((plan) => plan.id));
  if (ids.size !== plans.length) return null;
  if (plans.some((plan) => plan.dependsOn.some((dep) => !ids.has(dep)))) return null;
  return plans;
}

function visibleCoordinatorText(text: string): string {
  let visible = text;
  for (;;) {
    const closeAt = visible.indexOf(GROUP_GOAL_CONTROL_CLOSE);
    if (closeAt < 0) break;
    const openAt = visible.lastIndexOf(GROUP_GOAL_CONTROL_OPEN, closeAt);
    if (openAt < 0) {
      visible = `${visible.slice(0, closeAt)}${visible.slice(closeAt + GROUP_GOAL_CONTROL_CLOSE.length)}`;
      continue;
    }
    visible = `${visible.slice(0, openAt)}${visible.slice(closeAt + GROUP_GOAL_CONTROL_CLOSE.length)}`;
  }
  // Never expose a half-written control marker or JSON fragment.
  const danglingOpen = visible.indexOf(GROUP_GOAL_CONTROL_OPEN);
  if (danglingOpen >= 0) visible = visible.slice(0, danglingOpen);
  return visible.replaceAll(GROUP_GOAL_CONTROL_CLOSE, "").trim();
}

/** The last complete envelope wins, so a quoted example earlier in the reply cannot steer the run. */
export function parseGroupGoalDecision(text: string, opts?: { tasksAllowed?: boolean }): ParsedGroupGoalDecision {
  const closeAt = text.lastIndexOf(GROUP_GOAL_CONTROL_CLOSE);
  const openAt = closeAt < 0 ? -1 : text.lastIndexOf(GROUP_GOAL_CONTROL_OPEN, closeAt);
  if (openAt < 0 || closeAt < 0) return { visibleText: visibleCoordinatorText(text), decision: null };

  const visibleText = visibleCoordinatorText(text);
  const payload = text.slice(openAt + GROUP_GOAL_CONTROL_OPEN.length, closeAt).trim();
  try {
    const raw = JSON.parse(payload) as Record<string, unknown>;
    const status = raw.status;
    const detail = bounded(raw.detail, 500);
    if (status === "continue") {
      if (opts?.tasksAllowed && raw.tasks !== undefined) {
        const tasks = parseGoalTasks(raw.tasks);
        if (!tasks) return { visibleText, decision: null };
        return { visibleText, decision: { status, tasks, ...(detail ? { detail } : {}) } };
      }
      const next = bounded(raw.next, 100);
      const instruction = bounded(raw.instruction, 2_000);
      if (!next || !instruction) return { visibleText, decision: null };
      return {
        visibleText,
        decision: { status, next, instruction, ...(detail ? { detail } : {}) },
      };
    }
    if (status === "completed" || status === "needs-input" || status === "blocked") {
      if (!detail) return { visibleText, decision: null };
      return { visibleText, decision: { status, detail } };
    }
  } catch {
  }
  return { visibleText, decision: null };
}

/** A goal run never recruits somebody outside the room. */
export function selectGroupGoalCoordinator<Member extends GoalRunMember>(
  members: Member[],
  responder: GroupDefaultResponder,
): Member | null {
  const active = members.filter((member) => !member.hidden);
  const lead = responder.kind === "member" ? responder.botId : responder.kind === "auto" ? responder.fallbackBotId : undefined;
  if (lead) {
    const explicit = active.find((member) => member.id === lead);
    if (explicit) return explicit;
  }
  return active.find((member) => member.chiefOfStaff) ?? active[0] ?? null;
}

export function resolveGroupGoalMember(reference: string, members: GoalRunMember[]): GoalRunMember | null {
  const wanted = reference.trim().replace(/^@/, "").toLocaleLowerCase();
  if (!wanted) return null;
  const active = members.filter((member) => !member.hidden);
  const idMatch = active.find((member) => member.id.toLocaleLowerCase() === wanted);
  if (idMatch) return idMatch;
  const nameMatches = active.filter((member) => member.name.toLocaleLowerCase() === wanted);
  return nameMatches.length === 1 ? nameMatches[0]! : null;
}

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
}): string {
  const active = args.members.filter((member) => !member.hidden);
  const roster = active
    .map((member) => `${member.name} (${member.id})${member.title ? ` — ${member.title}` : ""}${args.roles?.[member.id] ? ` [team role: ${args.roles[member.id]}]` : ""}`)
    .join("; ");
  const self = args.solo ? active[0] : undefined;
  return [
    self ? "You are working alone toward a bounded goal." : "You are the lead coordinator for a bounded team goal run.",
    `Goal: ${args.goal}`,
    ...(self ? [] : [`Available room members: ${roster}.`]),
    `This is ${self ? "" : "team "}turn ${args.turn} of ${args.maxTurns}; ${args.remainingTurns} turn(s) remain after this one.`,
    ...(args.note ? [`Harness note: ${args.note}`] : []),
    self
      ? "Use the conversation as the progress ledger. Do the next concrete piece of work now, then decide whether the goal is genuinely complete, needs the human, is blocked, or needs another turn."
      : "Use the conversation as the progress ledger. Decide whether the goal is genuinely complete, needs the human, is blocked, or needs one named teammate next.",
    "Do not continue merely to generate discussion. Do not claim completion unless the requested deliverable or answer is present in the conversation.",
    "Write a brief human-facing update or final answer, then end with exactly one private control envelope on its own line.",
    self
      ? `${GROUP_GOAL_CONTROL_OPEN}{"status":"continue","next":"${self.id}","instruction":"Your next step","detail":"Short progress note"}${GROUP_GOAL_CONTROL_CLOSE}`
      : `${GROUP_GOAL_CONTROL_OPEN}{"status":"continue","next":"Exact member id from the roster","instruction":"Concrete next assignment","detail":"Short progress note"}${GROUP_GOAL_CONTROL_CLOSE}`,
    `Or use status "completed", "needs-input", or "blocked" with a non-empty "detail" and omit next/instruction.`,
    ...(args.tasksAllowed && !self ? [
      `When several pieces of work can move at the same time, first give each teammate you will use a role for this goal — one short line per teammate in your human-facing update (for example: "Scout — Researcher", "Miso — Implementer", "Quill — Reviewer") — then end with a plan envelope instead: ${GROUP_GOAL_CONTROL_OPEN}{"status":"continue","detail":"Short progress note","tasks":[{"id":"t1","assignee":"Exact member id from the roster","role":"Implementer","instruction":"Concrete assignment for that role","writes":["shared artifact it changes"],"dependsOn":[]}]}${GROUP_GOAL_CONTROL_CLOSE}`,
      "Plan rules: 1-8 tasks with unique ids; each task goes to an active roster member whose listed profile fits it, and its role field names that role — extend each teammate's own role, never contradict it; dependsOn lists ids from this plan only; declare reads/writes/locks when tasks share artifacts or a lock, omit them when independent — the scheduler already runs overlapping tasks in turn. Never re-dispatch work the ledger already shows as done: evaluate results first.",
    ] : []),
    ...(args.roles && !self ? [
      "Team roles are fixed for this room: you are the Lead and do no task yourself; implementation goes only to members with team role worker, and every worker task lists its writes; testing goes to the tester, review to the reviewer.",
      "The goal is complete only after the tester has passed the latest changes; when the tester reports failures, give each fix to the worker who owns that file.",
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
}): string {
  return [
    `You are a specialist contributing to a bounded team goal run led by ${args.coordinatorName}.`,
    `Goal: ${args.goal}`,
    ...(args.role ? [`Your role on this run: ${args.role}. Work within that role; hand off anything else back to ${args.coordinatorName}.`] : []),
    ...(args.teamRule ? [args.teamRule] : []),
    `Your assignment: ${args.assignment}`,
    `This is team turn ${args.turn} of ${args.maxTurns}.`,
    "Do the assigned work now and put concrete results, evidence, or a clear blocker in your reply.",
    `Address your result to ${args.coordinatorName}. Do not invent a new orchestration protocol or emit an openmaus-goal control envelope.`,
  ].join("\n");
}

export function groupGoalAssignmentKey(memberId: string, instruction: string): string {
  return `${memberId}:${instruction.trim().toLocaleLowerCase().replace(/\s+/g, " ")}`;
}

export type GoalStepOutcome =
  | "settled"
  | "provider_failed"
  | "dispatch_failed"
  | "spend_capped"
  | "stalled"
  | "timed_out"
  | "cancelled"
  | "busy"
  | "parked"
  | "unavailable";

export interface GoalStepResult {
  ran: boolean;
  replyText: string;
  outcome?: GoalStepOutcome;
  stopReason?: string | null;
  stopReasonText?: ServerText;
}

export type GoalRunEnd = Exclude<GroupGoalRunStatus, "working">;

export interface GoalRunDeps<Bot extends GoalRunMember> {
  run: { goal: string; turnCount: number; maxTurns: number; finished: boolean };
  coordinator: Bot;
  members: readonly Bot[];
  solo?: boolean;
  /** The coordinator may plan parallel waves; omitted means it may not. */
  tasksAllowed?: boolean;
  /** The room's standing team roles by member id; absent or empty runs the goal without role rules. */
  roles?: Readonly<Record<string, TeamRole>>;
  cancelled(): boolean;
  /** The member as the store has it now. */
  current(botId: string): Bot | undefined;
  /** A thread of the room for one wave task's own turn; undefined (or omitted) keeps the turn in the goal thread. */
  taskThread?(bot: Bot, assignment: string): { threadId: string } | undefined;
  /** Run one conflict-free batch through the runtime tree; the run loop still owns turn counting and outcome handling. */
  dispatchWave?(batch: Array<{ bot: Bot; role?: string; assignment: string; readOnly?: boolean }>): Promise<Array<{ botId: string; ran: boolean; replyText: string; outcome?: GoalStepOutcome; stopReason?: string | null }>>;
  /** Snapshot the room folder's write state before a wave batch; undefined disables the writes audit. */
  snapshotWrites?(): Promise<readonly string[] | undefined>;
  /** Paths changed since the snapshot that no task in the batch declared. */
  writesOutside?(before: readonly string[], declared: readonly string[]): Promise<string[] | undefined>;
  /** One member turn; a step counts against the run's turns once its member is claimed. A `lane` thread lets
   * wave tasks run beside each other, one provider turn per thread. */
  step(bot: Bot, coordinator: boolean, instructions: string, lane?: { threadId: string; brief: string }): Promise<GoalStepResult>;
  finish(status: GoalRunEnd, detail: string, text?: ServerText): void;
  progress(detail: string, text?: ServerText): void;
  /** An activity row in the conversation, from the coordinator. */
  note(text: string): void;
}

// spend_capped is deliberately absent: a cap refusal is deterministic.
const TRANSIENT_STEP: ReadonlySet<GoalStepOutcome | undefined> = new Set(["provider_failed", "dispatch_failed", "stalled", "timed_out"]);

async function dispatchWaveBatch<Bot extends GoalRunMember>(
  deps: GoalRunDeps<Bot>,
  entries: Array<{ plan: LeadTaskPlan; bot: Bot }>,
): Promise<Array<{ entry: { plan: LeadTaskPlan; bot: Bot }; result: GoalStepResult }>> {
  const dispatched = await deps.dispatchWave!(entries.map((entry) => ({
    bot: entry.bot, role: entry.plan.role, assignment: entry.plan.instruction, ...(deps.roles?.[entry.bot.id] === "reviewer" ? { readOnly: true } : {}),
  })));
  const normalize = (item: { ran: boolean; replyText: string; outcome?: GoalStepOutcome }) => ({
    ...item,
    outcome: item.outcome ?? (item.ran && item.replyText.trim() ? "settled" as const : "dispatch_failed" as const),
  });
  return entries.map((entry) => ({
    entry,
    result: dispatched.find((item) => item.botId === entry.bot.id) ?? { botId: entry.bot.id, ran: false, replyText: "", outcome: "dispatch_failed" as const },
  })).map(({ entry, result }) => ({ entry, result: normalize(result) }));
}

/** The member's AI refused for its usage limit or credits: retrying cannot help until it resets. */
export function outOfUsage(result: GoalStepResult): boolean {
  if (result.outcome === "settled" || result.outcome === "cancelled") return false;
  const kind = engineFailureKind(result.stopReason ?? "");
  return kind === "usage_limit" || kind === "credits";
}

async function stepOnceRetried<Bot extends GoalRunMember>(deps: GoalRunDeps<Bot>, bot: Bot, coordinator: boolean, instructions: string, lane?: { threadId: string; brief: string }): Promise<GoalStepResult> {
  const first = await deps.step(bot, coordinator, instructions, lane);
  if (!TRANSIENT_STEP.has(first.outcome) || outOfUsage(first) || deps.cancelled()) return first;
  const why = { provider_failed: "chat.notice.part.providerFailed", dispatch_failed: "chat.notice.part.dispatchFailed", stalled: "chat.notice.part.goalStalled", timed_out: "chat.notice.part.goalTimedOut" }[first.outcome as "provider_failed" | "dispatch_failed" | "stalled" | "timed_out"];
  const retry = noticeFailure("chat.notice.goalRetry", { name: bot.name, why });
  deps.progress(retry.message, retry.text);
  return deps.step(bot, coordinator, instructions, lane);
}

/** The goal run loop, the same for a room and a one-on-one chat (a room of one). */
export async function runGoalRun<Bot extends GoalRunMember>(deps: GoalRunDeps<Bot>): Promise<void> {
  const { run, coordinator } = deps;
  const assignmentCounts = new Map<string, number>();
  const tasksAllowed = deps.tasksAllowed ?? false;
  const goalMembers: GoalRunMember[] = deps.members.map((member) => ({
    id: member.id,
    name: member.name,
    title: member.title,
    description: member.description,
    hidden: member.hidden,
    chiefOfStaff: member.chiefOfStaff,
  }));

  let coordinatorNote: string | undefined;
  let waitExhaustions = 0;
  const roles = deps.roles && Object.keys(deps.roles).length > 0 ? deps.roles : undefined;
  const roleOf = (botId: string): TeamRole | undefined => roles?.[botId];
  const tester = roles ? goalMembers.find((member) => !member.hidden && roles[member.id] === "tester") : undefined;
  const team = { untested: false, fixRounds: 0, planRefusals: 0, earlyCompletions: 0 };
  /** Members whose AI ran out of usage during this run: no more tasks go to them. */
  const outOfRun = new Set<string>();
  /** Takes a member out of the run for its usage limit and names who can take its task; a reason means the run stops. */
  const replaceOutOfUsage = (bot: Bot, assignment: string): string | undefined => {
    outOfRun.add(bot.id);
    const role = roleOf(bot.id);
    const stand = goalMembers.find((member) => !member.hidden && member.id !== bot.id && member.id !== coordinator.id && !outOfRun.has(member.id) &&
      (roles ? roleOf(member.id) === role : true));
    if (!stand) return `${bot.name} ran out of AI usage and no other ${role ?? "teammate"} can take its work.`;
    deps.note(`${bot.name} ran out of AI usage — ${stand.name} takes its work`);
    coordinatorNote = `${bot.name} ran out of AI usage and is out of this run. Give its task "${assignment.slice(0, 160)}" to ${stand.name} (${stand.id}).`;
    return undefined;
  };
  /** Folds one settled member result into the Tester gate; a reason means the run stops there. */
  const settle = (bot: Bot, replyText: string): string | undefined => {
    const role = roleOf(bot.id);
    if (role === "worker") team.untested = true;
    if (role !== "tester") return undefined;
    const verdict = testerVerdict(replyText);
    if (verdict === "pass") {
      team.untested = false;
      return undefined;
    }
    team.fixRounds += 1;
    if (team.fixRounds > TEAM_MAX_FIX_ROUNDS) return `The Tester still failed the work after ${TEAM_MAX_FIX_ROUNDS} fix rounds.`;
    coordinatorNote = `${bot.name} (Tester) reported ${verdict === "fail" ? "FAIL" : "no verdict"}: ${replyText.replace(/\s+/g, " ").trim().slice(-400)}. ` +
      "Give each fix to the worker who owns that file, then have the tester run again.";
    return undefined;
  };
  while (!deps.cancelled() && run.turnCount < run.maxTurns) {
    const coordinatorTurn = run.turnCount + 1;
    const note = coordinatorNote;
    coordinatorNote = undefined;
    const coordinatorResult = await stepOnceRetried(deps, coordinator, true, groupGoalCoordinatorInstructions({
      goal: run.goal,
      members: goalMembers,
      turn: coordinatorTurn,
      maxTurns: run.maxTurns,
      remainingTurns: run.maxTurns - coordinatorTurn,
      note,
      solo: deps.solo,
      tasksAllowed,
      ...(roles ? { roles } : {}),
    }));
    if (deps.cancelled()) return;
    if (coordinatorResult.outcome === "unavailable") {
      deps.finish("blocked", `${coordinator.name} is not available.`);
      return;
    }
    if (coordinatorResult.outcome === "spend_capped") {
      deps.finish("blocked", coordinatorResult.stopReason ?? `${coordinator.name} hit the workspace spend cap.`);
      return;
    }
    if (coordinatorResult.outcome === "busy") {
      const code = coordinatorResult.stopReasonText;
      const busy = code?.key === "chat.notice.goalBusyOne" || code?.key === "chat.notice.goalBusyMany"
        ? noticeFailure(code.key === "chat.notice.goalBusyOne" ? "chat.notice.goalBusyOneAgain" : "chat.notice.goalBusyManyAgain", code.params as Record<string, string>) : undefined;
      deps.finish("blocked", busy?.message ?? `${coordinatorResult.stopReason ?? `${coordinator.name} stayed busy`} — send the goal again when they are free.`, busy?.text);
      return;
    }
    if (coordinatorResult.outcome === "parked") {
      deps.finish(
        "blocked",
        `${coordinatorResult.stopReason ?? `${coordinator.name} parked waiting for the computer`} — send the goal again when the computer is free.`,
      );
      return;
    }
    if (!coordinatorResult.ran || coordinatorResult.outcome !== "settled") {
      const reason = coordinatorResult.stopReason?.trim().slice(0, 120);
      deps.finish("failed", `${coordinator.name} could not complete the coordination step${reason ? ` — ${reason}` : ""}.`);
      return;
    }

    const decision = parseGroupGoalDecision(coordinatorResult.replyText, { tasksAllowed }).decision;
    if (!decision) {
      deps.finish("blocked", `${coordinator.name} did not provide a valid next-step decision.`);
      return;
    }
    if (decision.status === "completed" && tester && team.untested) {
      team.earlyCompletions += 1;
      if (team.earlyCompletions >= 2) {
        deps.finish("blocked", `${coordinator.name} called the goal done before the Tester passed the latest changes.`);
        return;
      }
      coordinatorNote = "Not done yet: the latest changes have not passed the tester. Plan a tester task, or fix what the tester reported.";
      continue;
    }
    if (decision.status !== "continue") {
      deps.finish(decision.status, decision.detail);
      return;
    }
    if (run.turnCount >= run.maxTurns) break;

    if ("tasks" in decision) {
      const tasks = roles
        ? withTesterTask(decision.tasks, (assignee) => roleOf(resolveGroupGoalMember(assignee, goalMembers)?.id ?? ""), tester)
        : decision.tasks;
      const planned: Array<{ plan: LeadTaskPlan; bot: Bot }> = [];
      for (const task of tasks) {
        const member = resolveGroupGoalMember(task.assignee, goalMembers);
        const bot = member ? deps.current(member.id) : undefined;
        if (!member || !bot || bot.hidden) {
          deps.finish("blocked", `${coordinator.name} planned a task for ${task.assignee}, who is not an available member of this channel.`);
          return;
        }
        planned.push({ plan: task, bot });
      }
      const outTask = planned.find(({ bot }) => outOfRun.has(bot.id));
      const problem = outTask
        ? `task ${outTask.plan.id} goes to ${outTask.bot.name}, whose AI ran out of usage in this run`
        : roles ? teamPlanProblem(planned.map(({ plan, bot }) => ({ plan, botId: bot.id, name: bot.name })), roleOf) : undefined;
      if (problem) {
        team.planRefusals += 1;
        if (team.planRefusals >= 3) {
          deps.finish("blocked", `${coordinator.name}'s plan kept breaking the team roles — ${problem}.`);
          return;
        }
        coordinatorNote = `Plan refused: ${problem}. Send a corrected plan.`;
        continue;
      }
      team.planRefusals = 0;
      // Same-bot tasks never share a batch: a bot runs one room turn at a time.
      const waves = leadWaves(
        planned.map(({ plan, bot }) => ({ ...leadBallotFromPlan(plan), locks: [...(plan.locks ?? []), `bot:${bot.id}`] })),
        Math.min(LEAD_MAX_WAVE_SIZE, new Set(planned.map(({ bot }) => bot.id)).size),
      );
      if (!waves.ok) {
        deps.finish("blocked", `${coordinator.name} planned an unschedulable task plan — ${waves.error}.`);
        return;
      }
      const byPlan = new Map(planned.map((entry) => [entry.plan.id, entry]));
      waveLoop:
      for (const wave of waves.waves) {
        if (deps.cancelled()) return;
        for (const batch of leadBatchesForWave(wave)) {
          if (deps.cancelled()) return;
          if (run.turnCount >= run.maxTurns) break waveLoop;
          const entries = batch.map((task) => byPlan.get(task.id)!);
          for (const entry of entries) {
            const assignmentKey = groupGoalAssignmentKey(entry.bot.id, entry.plan.instruction);
            const repeated = (assignmentCounts.get(assignmentKey) ?? 0) + 1;
            assignmentCounts.set(assignmentKey, repeated);
            if (repeated >= 3) {
              deps.finish("blocked", `The team repeated the same assignment three times without resolving the goal.`);
              return;
            }
          }
          const runTask = (entry: { plan: LeadTaskPlan; bot: Bot }, lane?: { threadId: string }) => {
            const step = stepOnceRetried(deps, entry.bot, false, groupGoalWorkerInstructions({
              goal: run.goal,
              coordinatorName: coordinator.name,
              role: entry.plan.role,
              assignment: entry.plan.instruction,
              turn: run.turnCount + 1,
              maxTurns: run.maxTurns,
              teamRule: teamRoleRule(roleOf(entry.bot.id)),
            }), lane ? { threadId: lane.threadId, brief: entry.plan.role ? `${entry.plan.role}: ${entry.plan.instruction}` : entry.plan.instruction } : undefined);
            return step.then((result) => ({ entry, result }));
          };
          // Wave tasks run beside each other only when every one of them gets its own lane thread;
          // one provider turn per thread is a server invariant.
          const lanes = deps.solo ? [] : entries.map((entry) => deps.taskThread?.(entry.bot, entry.plan.instruction));
          const declared = entries.flatMap((entry) => entry.plan.writes ?? []);
          const writesBefore = deps.snapshotWrites && !deps.solo ? await deps.snapshotWrites() : undefined;
          const results = deps.dispatchWave && !deps.solo
            ? await dispatchWaveBatch(deps, entries)
            : lanes.every((lane) => lane)
              ? await Promise.all(entries.map((entry, index) => runTask(entry, lanes[index])))
              : await (async () => {
                const settled: Array<{ entry: { plan: LeadTaskPlan; bot: Bot }; result: GoalStepResult }> = [];
                for (const [index, entry] of entries.entries()) settled.push(await runTask(entry, lanes[index]));
                return settled;
              })();
          // Runtime-dispatched children never claim through onClaimed; a parallel batch is one team turn, however many ran.
          if (deps.dispatchWave && !deps.solo && results.some(({ result }) => result.ran)) run.turnCount += 1;
          if (deps.cancelled()) return;
          if (writesBefore && deps.writesOutside) {
            const outside = await deps.writesOutside(writesBefore, declared);
            if (outside?.length) {
              const who = [...new Set(results.filter(({ result }) => result.ran).map(({ entry }) => entry.bot.name))].join(", ");
              deps.note(`${who} changed files outside their declared writes: ${outside.slice(0, 5).join(", ")}${outside.length > 5 ? ` (+${outside.length - 5} more)` : ""}`);
            }
          }
          for (const { entry, result } of results) {
            if (outOfUsage(result)) {
              const stop = replaceOutOfUsage(entry.bot, entry.plan.instruction);
              if (stop) {
                deps.finish("blocked", stop);
                return;
              }
              continue;
            }
            if (result.outcome === "unavailable") {
              deps.finish("blocked", `${entry.bot.name} is not available.`);
              return;
            }
            if (result.outcome === "spend_capped") {
              deps.finish("blocked", result.stopReason ?? `${entry.bot.name} hit the workspace spend cap.`);
              return;
            }
            if (result.outcome === "busy" || result.outcome === "parked") {
              waitExhaustions += 1;
              if (waitExhaustions >= GROUP_GOAL_MAX_WAIT_EXHAUSTIONS) {
                deps.finish("blocked", `Teammates stayed busy past the wait limit ${waitExhaustions} times — try again when the team is free.`);
                return;
              }
              const reason = result.stopReason?.trim().slice(0, 120) ?? `${entry.bot.name} stayed busy`;
              deps.note(`${reason} — asking ${coordinator.name} to reassign`);
              deps.progress(`${reason}. ${coordinator.name} is reassigning.`);
              coordinatorNote =
                `${reason} and could not take the assignment "${entry.plan.instruction.slice(0, 160)}". ` +
                "Reassign it to another available member, do it yourself if you can, or report blocked.";
            } else if (!result.ran || result.outcome !== "settled" || !result.replyText.trim()) {
              const reason = result.stopReason?.trim().slice(0, 120);
              deps.finish("failed", `${entry.bot.name} could not return a result to ${coordinator.name}${reason ? ` — ${reason}` : ""}.`);
              return;
            } else {
              const stop = settle(entry.bot, result.replyText);
              if (stop) {
                deps.finish("blocked", stop);
                return;
              }
            }
          }
          if (coordinatorNote) break waveLoop;
        }
      }
      continue;
    }

    const worker = resolveGroupGoalMember(decision.next, goalMembers);
    if (!worker) {
      deps.finish("blocked", `${coordinator.name} selected a teammate who is not an active member of this channel.`);
      return;
    }
    const workerBot = deps.current(worker.id);
    if (workerBot && outOfRun.has(workerBot.id)) {
      coordinatorNote = `${workerBot.name}'s AI ran out of usage in this run; give the assignment to someone else.`;
      continue;
    }
    if (!workerBot || workerBot.hidden) {
      deps.finish("blocked", `${worker.name} is not available.`);
      return;
    }
    const assignmentKey = groupGoalAssignmentKey(worker.id, decision.instruction);
    const repeated = (assignmentCounts.get(assignmentKey) ?? 0) + 1;
    assignmentCounts.set(assignmentKey, repeated);
    if (repeated >= 3) {
      deps.finish("blocked", `The team repeated the same assignment three times without resolving the goal.`);
      return;
    }
    if (deps.solo && workerBot.id === coordinator.id) {
      coordinatorNote = `Your next step: ${decision.instruction}`;
      continue;
    }

    const workerTurn = run.turnCount + 1;
    const workerResult = await stepOnceRetried(deps, workerBot, false, groupGoalWorkerInstructions({
      goal: run.goal,
      coordinatorName: coordinator.name,
      assignment: decision.instruction,
      turn: workerTurn,
      maxTurns: run.maxTurns,
      teamRule: teamRoleRule(roleOf(workerBot.id)),
    }));
    if (deps.cancelled()) return;
    if (outOfUsage(workerResult)) {
      const stop = replaceOutOfUsage(workerBot, decision.instruction);
      if (stop) {
        deps.finish("blocked", stop);
        return;
      }
      continue;
    }
    if (workerResult.outcome === "unavailable") {
      deps.finish("blocked", `${workerBot.name} is not available.`);
      return;
    }
    if (workerResult.outcome === "spend_capped") {
      deps.finish("blocked", workerResult.stopReason ?? `${workerBot.name} hit the workspace spend cap.`);
      return;
    }
    if (workerResult.outcome === "busy" || workerResult.outcome === "parked") {
      waitExhaustions += 1;
      if (waitExhaustions >= GROUP_GOAL_MAX_WAIT_EXHAUSTIONS) {
        deps.finish("blocked", `Teammates stayed busy past the wait limit ${waitExhaustions} times — try again when the team is free.`);
        return;
      }
      const reason = workerResult.stopReason?.trim().slice(0, 120) ?? `${workerBot.name} stayed busy`;
      deps.note(`${reason} — asking ${coordinator.name} to reassign`);
      deps.progress(`${reason}. ${coordinator.name} is reassigning.`);
      coordinatorNote =
        `${reason} and could not take the assignment "${decision.instruction.slice(0, 160)}". ` +
        "Reassign it to another available member, do it yourself if you can, or report blocked.";
      continue;
    }
    if (!workerResult.ran || workerResult.outcome !== "settled" || !workerResult.replyText.trim()) {
      const reason = workerResult.stopReason?.trim().slice(0, 120);
      deps.finish("failed", `${workerBot.name} could not return a result to ${coordinator.name}${reason ? ` — ${reason}` : ""}.`);
      return;
    }
    const stop = settle(workerBot, workerResult.replyText);
    if (stop) {
      deps.finish("blocked", stop);
      return;
    }
  }

  if (!deps.cancelled() && !run.finished) {
    deps.finish("limit-reached", `Paused at the ${run.maxTurns}-turn safety limit. Send the goal again to continue with a fresh bounded run.`);
  }
}
