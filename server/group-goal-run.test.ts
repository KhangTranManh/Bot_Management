import { describe, expect, it } from "vitest";
import type { RoomProjectProfile } from "../shared/wire.ts";
import type { GoalBaseline } from "../shared/group-goal-run.ts";
import type { TeamRole } from "../shared/team-roles.ts";
import type { GoalBrief, GoalConflict } from "../shared/group-goal-run.ts";
import type { WritesSnapshot } from "./writes-audit.ts";
import type { MetricReading } from "./research-goal.ts";
import {
  GROUP_GOAL_CONTROL_CLOSE,
  GROUP_GOAL_CONTROL_OPEN,
  GROUP_GOAL_MAX_TURNS,
  groupGoalAssignmentKey,
  groupGoalCompletionTurnId,
  groupGoalCoordinatorInstructions,
  parseGroupGoalDecision,
  resolveGroupGoalMember,
  runGoalRun,
  selectGroupGoalCoordinator,
  type GoalRunEnd,
  type GoalStepResult,
  type ResearchRunRules,
} from "./group-goal-run.ts";

const members = [
  { id: "scout-id", name: "Scout" },
  { id: "chief-id", name: "Miso", chiefOfStaff: true },
  { id: "old-id", name: "Old", hidden: true },
];

describe("group goal runs", () => {
  it("keeps the bound provider identity when a completion event omits its turn id", () => {
    expect(groupGoalCompletionTurnId(undefined, "bound-turn")).toBe("bound-turn");
    expect(groupGoalCompletionTurnId("event-turn", "bound-turn")).toBe("event-turn");
  });

  it("strips and validates a coordinator decision", () => {
    const parsed = parseGroupGoalDecision(
      `I am asking Scout to verify it.\n${GROUP_GOAL_CONTROL_OPEN}`
      + `{"status":"continue","next":"@Scout","instruction":"Verify the release","detail":"Draft ready"}`
      + GROUP_GOAL_CONTROL_CLOSE,
    );
    expect(parsed.visibleText).toBe("I am asking Scout to verify it.");
    expect(parsed.decision).toEqual({
      status: "continue",
      next: "@Scout",
      instruction: "Verify the release",
      detail: "Draft ready",
    });
  });

  it("fails closed on incomplete or malformed decisions", () => {
    expect(parseGroupGoalDecision("ordinary reply")).toEqual({ visibleText: "ordinary reply", decision: null });
    expect(parseGroupGoalDecision(
      `${GROUP_GOAL_CONTROL_OPEN}{"status":"continue","next":"Scout"}${GROUP_GOAL_CONTROL_CLOSE}`,
    ).decision).toBeNull();
    expect(parseGroupGoalDecision(
      `${GROUP_GOAL_CONTROL_OPEN}{not json}${GROUP_GOAL_CONTROL_CLOSE}`,
    ).decision).toBeNull();
    expect(parseGroupGoalDecision(
      `Safe update\n${GROUP_GOAL_CONTROL_OPEN}{"status":"continue"}`,
    )).toEqual({ visibleText: "Safe update", decision: null });
  });

  it("parses a task plan only when tasks are allowed, with missing ballot fields defaulted", () => {
    const payload = {
      status: "continue",
      detail: "Plan",
      tasks: [
        { id: "t1", assignee: "Scout", role: "Implementer", instruction: "Draft the plan", writes: ["docs/plan.md"], dependsOn: [] },
        { id: "t2", assignee: "Miso", instruction: "Review it", reads: ["docs/plan.md"] },
      ],
    };
    const allowed = parseGroupGoalDecision(
      `Splitting it up.\n${GROUP_GOAL_CONTROL_OPEN}${JSON.stringify(payload)}${GROUP_GOAL_CONTROL_CLOSE}`,
      { tasksAllowed: true },
    );
    expect(allowed.visibleText).toBe("Splitting it up.");
    expect(allowed.decision).toEqual({
      status: "continue",
      detail: "Plan",
      tasks: [
        { id: "t1", assignee: "Scout", role: "Implementer", instruction: "Draft the plan", reads: [], writes: ["docs/plan.md"], locks: [], dependsOn: [] },
        { id: "t2", assignee: "Miso", instruction: "Review it", reads: ["docs/plan.md"], writes: [], locks: [], dependsOn: [] },
      ],
    });
    expect(parseGroupGoalDecision(
      `${GROUP_GOAL_CONTROL_OPEN}${JSON.stringify(payload)}${GROUP_GOAL_CONTROL_CLOSE}`,
    ).decision).toBeNull();
  });

  it("a task plan beats a single next, and malformed plans fail closed", () => {
    const tasks = [{ id: "t1", assignee: "Scout", instruction: "Do it" }];
    expect(parseGroupGoalDecision(
      `${GROUP_GOAL_CONTROL_OPEN}${JSON.stringify({ status: "continue", next: "Scout", instruction: "Single", tasks })}${GROUP_GOAL_CONTROL_CLOSE}`,
      { tasksAllowed: true },
    ).decision).toMatchObject({ status: "continue", tasks });

    const wrap = (tasks: unknown) =>
      parseGroupGoalDecision(
        `${GROUP_GOAL_CONTROL_OPEN}${JSON.stringify({ status: "continue", tasks })}${GROUP_GOAL_CONTROL_CLOSE}`,
        { tasksAllowed: true },
      ).decision;
    expect(wrap([])).toBeNull();
    expect(wrap("nope")).toBeNull();
    expect(wrap([{ id: "t1", instruction: "Do it" }])).toBeNull();
    expect(wrap([{ id: "t1", assignee: "Scout", instruction: "Do it" }, { id: "t1", assignee: "Miso", instruction: "Also" }])).toBeNull();
    expect(wrap([{ id: "t1", assignee: "Scout", instruction: "Do it", dependsOn: ["ghost"] }])).toBeNull();
    expect(wrap([{ id: "t1", assignee: "Scout", instruction: "Do it", writes: [""] }])).toBeNull();
    expect(wrap(Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, assignee: "Scout", instruction: "Do it" })))).toBeNull();
  });

  it("removes every private envelope while the last complete one controls", () => {
    const parsed = parseGroupGoalDecision(
      `First\n${GROUP_GOAL_CONTROL_OPEN}{"status":"blocked","detail":"old"}${GROUP_GOAL_CONTROL_CLOSE}`
      + `\nFinal\n${GROUP_GOAL_CONTROL_OPEN}{"status":"completed","detail":"done"}${GROUP_GOAL_CONTROL_CLOSE}`,
    );
    expect(parsed.visibleText).toBe("First\n\nFinal");
    expect(parsed.decision).toEqual({ status: "completed", detail: "done" });
  });

  it("honors an explicit active lead, then an in-room Chief", () => {
    expect(selectGroupGoalCoordinator(members, { kind: "member", botId: "scout-id" })?.id).toBe("scout-id");
    expect(selectGroupGoalCoordinator(members, { kind: "everyone" })?.id).toBe("chief-id");
    expect(selectGroupGoalCoordinator(members, { kind: "member", botId: "old-id" })?.id).toBe("chief-id");
  });

  it("resolves only an exact active room member", () => {
    expect(resolveGroupGoalMember("@SCOUT", members)?.id).toBe("scout-id");
    expect(resolveGroupGoalMember("chief-id", members)?.name).toBe("Miso");
    expect(resolveGroupGoalMember("Old", members)).toBeNull();
    expect(resolveGroupGoalMember("Sco", members)).toBeNull();
    expect(resolveGroupGoalMember("Scout", [
      ...members,
      { id: "other-scout", name: "Scout" },
    ])).toBeNull();
    expect(resolveGroupGoalMember("other-scout", [
      ...members,
      { id: "other-scout", name: "Scout" },
    ])?.id).toBe("other-scout");
  });

  it("normalizes repeated assignments for no-progress detection", () => {
    expect(groupGoalAssignmentKey("scout-id", "  Verify   THE release "))
      .toBe(groupGoalAssignmentKey("scout-id", "verify the release"));
  });

  it("reserves the final bounded turn for coordinator evaluation", () => {
    expect(GROUP_GOAL_MAX_TURNS % 2).toBe(1);
  });
});

describe("groupGoalCoordinatorInstructions harness note", () => {
  const base = {
    goal: "Ship the release notes",
    members: [{ id: "lead", name: "Lead" }, { id: "scout", name: "Scout" }],
    turn: 3,
    maxTurns: 13,
    remainingTurns: 10,
  };

  it("renders a harness note on its own line, before the ledger guidance", () => {
    const lines = groupGoalCoordinatorInstructions({ ...base, note: "Scout stayed busy for 30 minutes" }).split("\n");
    const noteAt = lines.indexOf("Harness note: Scout stayed busy for 30 minutes");
    const ledgerAt = lines.findIndex((line) => line.startsWith("Use the conversation as the progress ledger"));
    expect(noteAt).toBeGreaterThan(-1);
    expect(ledgerAt).toBeGreaterThan(noteAt);
  });

  it("omits the note line entirely when there is nothing to report", () => {
    expect(groupGoalCoordinatorInstructions(base)).not.toContain("Harness note:");
  });
});

/** A plan carries a brief, as the Lead is told to; `brief: null` sends one without it. */
const envelope = (decision: Record<string, unknown>) => {
  const withBrief = decision.tasks !== undefined && decision.brief === undefined ? { ...decision, brief: { goal: "Get every test passing" } } : decision;
  const sent = withBrief.brief === null ? Object.fromEntries(Object.entries(withBrief).filter(([key]) => key !== "brief")) : withBrief;
  return `Update.\n${GROUP_GOAL_CONTROL_OPEN}${JSON.stringify(sent)}${GROUP_GOAL_CONTROL_CLOSE}`;
};
const settled = (replyText: string): GoalStepResult => ({ ran: true, replyText, outcome: "settled" });

/** Drives the real loop with scripted steps; a step that runs counts one turn, as a claimed member turn does. */
function goalRun(options: {
  solo?: boolean;
  tasksAllowed?: boolean;
  roles?: Record<string, TeamRole>;
  members?: Array<{ id: string; name: string }>;
  steps: Array<GoalStepResult | ((call: number) => GoalStepResult)>;
  cancelAfter?: number;
  vendorOf?: (botId: string) => string | undefined;
  verify?: Array<{ id: string; command: string; expectExit?: number }>;
  runVerify?: (command: { id: string; command: string }) => Promise<{ id: string; exitCode: number | null; output: string }>;
  snapshotWrites?: () => Promise<WritesSnapshot | undefined>;
  writesOutside?: (before: WritesSnapshot, declared: readonly string[]) => Promise<string[] | undefined>;
  verifyRefusal?: string;
  projectProfile?: RoomProjectProfile;
  projectRefusal?: string;
  cancelled?: () => boolean;
  research?: Partial<ResearchRunRules>;
  heldOutTouched?: (botId: string, sinceMs: number) => Promise<string[]>;
  missingHandoffFiles?: () => Promise<string[]>;
  readMetric?: () => Promise<MetricReading>;
  recordMetric?: (value: number) => void;
  dispatchWave?: (batch: Array<{ bot: { id: string; name: string }; role?: string; assignment: string }>) => Promise<Array<{ botId: string; ran: boolean; replyText: string; outcome?: GoalStepResult["outcome"]; stopReason?: string | null }>>;
  laneEdits?: (botId: string, sinceMs: number) => Promise<string[]>;
  steerLane?: (botId: string, text: string) => Promise<boolean>;
  watchMs?: number;
}) {
  const members = options.members ?? [{ id: "solo-id", name: "Solo" }];
  const run = { goal: "Get every test passing", turnCount: 0, maxTurns: GROUP_GOAL_MAX_TURNS, finished: false };
  const calls: Array<{ bot: string; coordinator: boolean; instructions: string }> = [];
  const finished: Array<{ status: GoalRunEnd; detail: string }> = [];
  const progress: string[] = [];
  const notes: string[] = [];
  const briefs: GoalBrief[] = [];
  const conflicts: GoalConflict[] = [];
  const baselines: GoalBaseline[] = [];
  let cancelled = false;
  const done = runGoalRun({
    run,
    coordinator: members[0]!,
    members,
    solo: options.solo,
    tasksAllowed: options.tasksAllowed,
    ...(options.roles ? { roles: options.roles } : {}),
    ...(options.vendorOf ? { vendorOf: options.vendorOf } : {}),
    ...(options.verify ? { verify: options.verify } : {}),
    ...(options.runVerify ? { runVerify: options.runVerify } : {}),
    ...(options.verifyRefusal ? { verifyRefusal: options.verifyRefusal } : {}),
    projectProfile: options.projectProfile,
    projectRefusal: options.projectRefusal,
    recordBaseline: (baseline) => baselines.push(baseline),
    ...(options.snapshotWrites ? { snapshotWrites: options.snapshotWrites } : {}),
    ...(options.writesOutside ? { writesOutside: options.writesOutside } : {}),
    ...(options.research ? { research: { budgetWallMinutes: 600, budgetSpentMs: 0, ...options.research } } : {}),
    ...(options.heldOutTouched ? { heldOutTouched: options.heldOutTouched } : {}),
    ...(options.missingHandoffFiles ? { missingHandoffFiles: options.missingHandoffFiles } : {}),
    ...(options.readMetric ? { readMetric: options.readMetric } : {}),
    ...(options.recordMetric ? { recordMetric: options.recordMetric } : {}),
    ...(options.dispatchWave ? { dispatchWave: options.dispatchWave } : {}),
    ...(options.laneEdits ? { laneEdits: options.laneEdits } : {}),
    ...(options.steerLane ? { steerLane: options.steerLane } : {}),
    ...(options.watchMs ? { watchMs: options.watchMs } : {}),
    recordConflict: (conflict) => conflicts.push(conflict),
    cancelled: () => cancelled || Boolean(options.cancelled?.()),
    current: (id) => members.find((member) => member.id === id),
    step: async (bot, coordinator, instructions) => {
      calls.push({ bot: bot.id, coordinator, instructions });
      const scripted = options.steps[Math.min(calls.length - 1, options.steps.length - 1)]!;
      const result = typeof scripted === "function" ? scripted(calls.length) : scripted;
      if (result.ran) run.turnCount += 1;
      if (options.cancelAfter === calls.length || calls.length > 4 * GROUP_GOAL_MAX_TURNS) cancelled = true;
      return result;
    },
    finish: (status, detail) => {
      run.finished = true;
      finished.push({ status, detail });
    },
    progress: (detail) => progress.push(detail),
    note: (text) => notes.push(text),
    recordBrief: (brief) => briefs.push(brief),
  });
  return { done, run, calls, finished, progress, notes, briefs, conflicts, baselines };
}

describe("one goal-run loop for a room and a one-on-one chat", () => {
  it("in a room of one the bot works in its own turns and finishes on the done marker", async () => {
    const goal = goalRun({
      solo: true,
      steps: [
        settled(envelope({ status: "continue", next: "solo-id", instruction: "Fix the failing parser test", detail: "Half done" })),
        settled(envelope({ status: "completed", detail: "Every test passes." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => [call.bot, call.coordinator])).toEqual([["solo-id", true], ["solo-id", true]]);
    expect(goal.calls[0]!.instructions).toContain("You are working alone toward a bounded goal.");
    expect(goal.calls[0]!.instructions).toContain(`"next":"solo-id"`);
    expect(goal.calls[0]!.instructions).not.toContain("Available room members");
    expect(goal.calls[1]!.instructions).toContain("Harness note: Your next step: Fix the failing parser test");
    expect(goal.finished).toEqual([{ status: "completed", detail: "Every test passes." }]);
    expect(goal.run.turnCount).toBe(2);
  });

  it("stops a room of one at the same turn cap as a room", async () => {
    const goal = goalRun({
      solo: true,
      steps: [(call) => settled(envelope({ status: "continue", next: "Solo", instruction: `Try approach ${call}`, detail: "Still going" }))],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(GROUP_GOAL_MAX_TURNS);
    expect(goal.finished).toEqual([{ status: "limit-reached", detail: expect.stringContaining(`${GROUP_GOAL_MAX_TURNS}-turn safety limit`) }]);
  });

  it("blocks on the spend cap without retrying the refused turn", async () => {
    const goal = goalRun({
      solo: true,
      steps: [
        settled(envelope({ status: "continue", next: "solo-id", instruction: "Keep going", detail: "Working" })),
        { ran: false, replyText: "", outcome: "spend_capped", stopReason: "this workspace has reached its monthly spend limit of $0.01" },
      ],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(2);
    expect(goal.finished).toEqual([{ status: "blocked", detail: "this workspace has reached its monthly spend limit of $0.01" }]);
  });

  it("retries a turn that did not settle once, then fails the run", async () => {
    const goal = goalRun({ solo: true, steps: [{ ran: true, replyText: "", outcome: "provider_failed", stopReason: "exit 1" }] });
    await goal.done;
    expect(goal.calls).toHaveLength(2);
    expect(goal.progress).toContain("Solo's turn did not settle (provider failed) — retrying once.");
    expect(goal.finished).toEqual([{ status: "failed", detail: "Solo could not complete the coordination step — exit 1." }]);
  });

  it("never takes a reply without a valid marker as done", async () => {
    const goal = goalRun({ solo: true, steps: [settled("All done, trust me.")] });
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.finished).toEqual([{ status: "blocked", detail: "Solo did not provide a valid next-step decision." }]);
  });

  it("blocks a room of one that repeats the same next step", async () => {
    const goal = goalRun({ solo: true, steps: [settled(envelope({ status: "continue", next: "solo-id", instruction: "Same thing", detail: "Again" }))] });
    await goal.done;
    expect(goal.calls).toHaveLength(3);
    expect(goal.finished[0]?.status).toBe("blocked");
  });

  it("a stopped run ends without finishing again or starting another turn", async () => {
    const goal = goalRun({
      solo: true,
      cancelAfter: 1,
      steps: [settled(envelope({ status: "continue", next: "solo-id", instruction: "Keep going", detail: "Working" }))],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.finished).toEqual([]);
  });

  it("a room still hands each assignment to a worker turn", async () => {
    const goal = goalRun({
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }],
      steps: [
        settled(envelope({ status: "continue", next: "Scout", instruction: "Verify the draft", detail: "Drafted" })),
        settled("Verified."),
        settled(envelope({ status: "completed", detail: "Draft verified." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => [call.bot, call.coordinator])).toEqual([["lead-id", true], ["scout-id", false], ["lead-id", true]]);
    expect(goal.calls[0]!.instructions).toContain("Available room members: Lead (lead-id); Scout (scout-id).");
    expect(goal.finished).toEqual([{ status: "completed", detail: "Draft verified." }]);
  });

  it("runs a task plan in waves: one worker step per task, the coordinator evaluates afterwards", async () => {
    const tasks = [
      { id: "t1", assignee: "Scout", role: "Implementer", instruction: "Draft the plan", writes: ["docs/plan.md"] },
      { id: "t2", assignee: "Miso", instruction: "List the risks" },
      { id: "t3", assignee: "Scout", instruction: "Review the plan", reads: ["docs/plan.md"], dependsOn: ["t1"] },
    ];
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }, { id: "miso-id", name: "Miso" }],
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks })),
        settled("Drafted."),
        settled("Listed."),
        settled("Reviewed."),
        settled(envelope({ status: "completed", detail: "Plan reviewed." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => [call.bot, call.coordinator])).toEqual([
      ["lead-id", true], ["scout-id", false], ["miso-id", false], ["scout-id", false], ["lead-id", true],
    ]);
    expect(goal.calls[1]!.instructions).toContain("Your role on this run: Implementer.");
    expect(goal.calls[1]!.instructions).toContain("Your assignment: Draft the plan");
    expect(goal.calls[0]!.instructions).toContain('"tasks":[');
    expect(goal.finished).toEqual([{ status: "completed", detail: "Plan reviewed." }]);
    expect(goal.run.turnCount).toBe(5);
  });

  it("serializes tasks of the same bot and tasks with clashing writes inside a wave", async () => {
    const tasks = [
      { id: "t1", assignee: "Scout", instruction: "First", writes: ["shared.md"] },
      { id: "t2", assignee: "Miso", instruction: "Clashing", writes: ["shared.md"] },
      { id: "t3", assignee: "Scout", instruction: "Third", writes: ["other.md"] },
    ];
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }, { id: "miso-id", name: "Miso" }],
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks })),
        settled("t1 done."),
        settled("t2 done."),
        settled("t3 done."),
        settled(envelope({ status: "completed", detail: "Done." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "scout-id", "miso-id", "scout-id", "lead-id"]);
    expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
  });

  it("blocks a plan whose assignee is not an active member", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }],
      steps: [settled(envelope({ status: "continue", detail: "Plan", tasks: [{ id: "t1", assignee: "Ghost", instruction: "Do it" }] }))],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.finished).toEqual([{ status: "blocked", detail: "Lead planned a task for Ghost, who is not an available member of this channel." }]);
  });

  it("a hard worker failure inside a wave fails or blocks the run", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }, { id: "miso-id", name: "Miso" }],
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [
          { id: "t1", assignee: "Scout", instruction: "First" },
          { id: "t2", assignee: "Miso", instruction: "Second" },
        ] })),
        { ran: false, replyText: "", outcome: "unavailable" },
        settled("Second done."),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "scout-id", "miso-id"]);
    expect(goal.finished).toEqual([{ status: "blocked", detail: "Scout is not available." }]);
  });

  it("blocks a team that replans the same task three times", async () => {
    const plan = { status: "continue", detail: "Plan", tasks: [{ id: "t1", assignee: "Scout", instruction: "Same thing" }] };
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }],
      steps: [
        settled(`${GROUP_GOAL_CONTROL_OPEN}${JSON.stringify(plan)}${GROUP_GOAL_CONTROL_CLOSE}`),
        settled("Done."),
        settled(`${GROUP_GOAL_CONTROL_OPEN}${JSON.stringify(plan)}${GROUP_GOAL_CONTROL_CLOSE}`),
        settled("Done."),
        settled(`${GROUP_GOAL_CONTROL_OPEN}${JSON.stringify(plan)}${GROUP_GOAL_CONTROL_CLOSE}`),
      ],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(5);
    expect(goal.finished[0]?.status).toBe("blocked");
  });

  it("dispatches a wave batch through dispatchWave; the run counts the batch as one turn", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }, { id: "miso-id", name: "Miso" }],
      dispatchWave: async (batch) => batch.map((task) => ({ botId: task.bot.id, ran: true, replyText: `${task.assignment} done.` })),
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [
          { id: "t1", assignee: "Scout", instruction: "First" },
          { id: "t2", assignee: "Miso", instruction: "Second" },
        ] })),
        settled(envelope({ status: "completed", detail: "Both done." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => [call.bot, call.coordinator])).toEqual([["lead-id", true], ["lead-id", true]]);
    expect(goal.finished).toEqual([{ status: "completed", detail: "Both done." }]);
    expect(goal.run.turnCount).toBe(3);
  });

  it("a dispatchWave hard failure finishes the run like a single-worker failure", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }, { id: "miso-id", name: "Miso" }],
      dispatchWave: async (batch) => batch.map((task) => task.bot.id === "scout-id"
        ? { botId: task.bot.id, ran: false, replyText: "", outcome: "unavailable" as const }
        : { botId: task.bot.id, ran: true, replyText: "done." }),
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [
          { id: "t1", assignee: "Scout", instruction: "First" },
          { id: "t2", assignee: "Miso", instruction: "Second" },
        ] })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "blocked", detail: "Scout is not available." }]);
    expect(goal.run.turnCount).toBe(2);
  });

  it("a batch task missing from the dispatch result fails closed", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }, { id: "miso-id", name: "Miso" }],
      dispatchWave: async (batch) => batch.filter((task) => task.bot.id === "scout-id").map((task) => ({ botId: task.bot.id, ran: true, replyText: "done." })),
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [
          { id: "t1", assignee: "Scout", instruction: "First" },
          { id: "t2", assignee: "Miso", instruction: "Second" },
        ] })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "failed", detail: "Miso could not return a result to Lead." }]);
  });

  it("without tasks allowed a tasks-only envelope fails closed like any malformed one", async () => {
    const goal = goalRun({
      members: [{ id: "lead-id", name: "Lead" }, { id: "scout-id", name: "Scout" }],
      steps: [settled(envelope({ status: "continue", detail: "Plan", tasks: [{ id: "t1", assignee: "Scout", instruction: "Do it" }] }))],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(1);
    expect(goal.finished).toEqual([{ status: "blocked", detail: "Lead did not provide a valid next-step decision." }]);
  });
});

describe("team roles in a goal run", () => {
  const team = [{ id: "lead-id", name: "Lead" }, { id: "worker-id", name: "Builder" }, { id: "tester-id", name: "Checker" }];
  const roles: Record<string, TeamRole> = { "lead-id": "lead", "worker-id": "worker", "tester-id": "tester" };
  const work = [{ id: "t1", assignee: "Builder", instruction: "Add the checkout page", writes: ["src/checkout.tsx"] }];

  it("requires declared Worker tasks when waves are enabled, then runs the corrected plan", async () => {
    const goal = goalRun({ tasksAllowed: true, roles, members: team, steps: [
      settled(envelope({ status: "continue", next: "Builder", instruction: "Build everything", detail: "Work" })),
      settled(envelope({ status: "continue", detail: "Plan", tasks: work })),
      settled("Built."), settled("VERDICT: PASS"),
      settled(envelope({ status: "completed", detail: "Done." })),
    ] });
    await goal.done;
    expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "lead-id", "worker-id", "tester-id", "lead-id"]);
    expect(goal.calls[1]!.instructions).toContain("Plan required");
    expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
  });

  it("requires a Reviewer turn before completing after a Worker change", async () => {
    const goal = goalRun({ tasksAllowed: false, roles: { ...roles, "review-id": "reviewer" }, members: [...team, { id: "review-id", name: "Review" }], steps: [
      settled(envelope({ status: "continue", next: "Builder", instruction: "Build", detail: "Build" })),
      settled("Built."),
      settled(envelope({ status: "completed", detail: "Done." })),
      settled(envelope({ status: "completed", detail: "Done." })),
    ] });
    await goal.done;
    expect(goal.calls[3]!.instructions).toContain("have the Reviewer inspect the latest changes");
    expect(goal.finished).toEqual([{ status: "blocked", detail: expect.stringContaining("before the Reviewer reviewed") }]);
  });

  it("adds a Tester task after the work, tells each role its rule, and completes once the Tester passes", async () => {
    const goal = goalRun({
      tasksAllowed: true, roles, members: team,
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: work })),
        settled("Added src/checkout.tsx."),
        settled("Build and tests ran.\nVERDICT: PASS"),
        settled(envelope({ status: "completed", detail: "Checkout shipped." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "worker-id", "tester-id", "lead-id"]);
    expect(goal.calls[0]!.instructions).toContain("[team role: worker]");
    expect(goal.calls[1]!.instructions).toContain("You are a Worker");
    expect(goal.calls[2]!.instructions).toContain("VERDICT: PASS or VERDICT: FAIL");
    expect(goal.calls[2]!.instructions).toContain("Test the changes from t1");
    expect(goal.finished).toEqual([{ status: "completed", detail: "Checkout shipped." }]);
  });

  it("refuses a plan that gives work to the Lead or a Worker task without writes, and asks again", async () => {
    const goal = goalRun({
      tasksAllowed: true, roles, members: team,
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [{ id: "t1", assignee: "Builder", instruction: "Add it" }] })),
        settled(envelope({ status: "continue", detail: "Plan", tasks: [{ id: "t1", assignee: "Lead", instruction: "Do it", writes: ["a.ts"] }] })),
        settled(envelope({ status: "continue", detail: "Plan", tasks: [{ id: "t1", assignee: "Builder", instruction: "Add it" }] })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "lead-id", "lead-id"]);
    expect(goal.calls[1]!.instructions).toContain("Plan refused: task t1 for Worker Builder declares no writes");
    expect(goal.calls[2]!.instructions).toContain("who is the Lead");
    expect(goal.finished).toEqual([{ status: "blocked", detail: expect.stringContaining("kept breaking the team roles") }]);
  });

  it("does not let the Lead complete before the Tester passes, and sends the Tester's failure back as a fix round", async () => {
    const goal = goalRun({
      tasksAllowed: true, roles, members: team,
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: work })),
        settled("Added src/checkout.tsx."),
        settled("Checkout test fails: total is NaN.\nVERDICT: FAIL"),
        settled(envelope({ status: "completed", detail: "Done anyway." })),
        settled(envelope({ status: "continue", detail: "Fix", tasks: [{ id: "t2", assignee: "Builder", instruction: "Fix the NaN total", writes: ["src/checkout.tsx"] }] })),
        settled("Fixed the total."),
        settled("All green.\nVERDICT: PASS"),
        settled(envelope({ status: "completed", detail: "Checkout fixed." })),
      ],
    });
    await goal.done;
    expect(goal.calls[3]!.instructions).toContain("Checker (Tester) reported FAIL");
    expect(goal.calls[3]!.instructions).toContain("total is NaN");
    expect(goal.calls[4]!.instructions).toContain("Not done yet: the latest changes have not passed the tester");
    expect(goal.finished).toEqual([{ status: "completed", detail: "Checkout fixed." }]);
  });

  it("blocks after the fix rounds run out", async () => {
    const steps: GoalStepResult[] = [];
    for (let round = 0; round < 4; round++) {
      steps.push(settled(envelope({ status: "continue", detail: "Try", tasks: [{ id: `t${round}`, assignee: "Builder", instruction: `Attempt ${round}`, writes: ["a.ts"] }] })));
      steps.push(settled(`Attempt ${round} done.`));
      steps.push(settled("Still broken.\nVERDICT: FAIL"));
    }
    const goal = goalRun({ tasksAllowed: true, roles, members: team, steps });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "blocked", detail: "The Tester still failed the work after 3 fix rounds." }]);
  });

  it("runs a goal without roles exactly as before", async () => {
    const goal = goalRun({
      tasksAllowed: true, members: team,
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [{ id: "t1", assignee: "Builder", instruction: "Add it" }] })),
        settled("Added."),
        settled(envelope({ status: "completed", detail: "Done." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "worker-id", "lead-id"]);
    expect(goal.calls[0]!.instructions).not.toContain("team role");
    expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
  });

  it("counts each wave batch as one team turn and marks a Reviewer's task read-only", async () => {
    const reviewRoles: Record<string, TeamRole> = { "lead-id": "lead", "worker-id": "worker", "tester-id": "reviewer" };
    const batches: Array<Array<{ botId: string; readOnly?: boolean }>> = [];
    const goal = goalRun({
      tasksAllowed: true, roles: reviewRoles, members: team,
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [...work, { id: "r1", assignee: "Checker", instruction: "Review the design doc", dependsOn: ["t1"] }] })),
        settled(envelope({ status: "completed", detail: "Done." })),
      ],
      dispatchWave: async (batch) => {
        batches.push(batch.map((task) => ({ botId: task.bot.id, ...((task as { readOnly?: boolean }).readOnly ? { readOnly: true } : {}) })));
        return batch.map((task) => ({ botId: task.bot.id, ran: true, replyText: "ok\nREVIEW: CLEAR", outcome: "settled" as const }));
      },
    });
    await goal.done;
    expect(batches).toEqual([[{ botId: "worker-id" }], [{ botId: "tester-id", readOnly: true }]]);
    expect(goal.run.turnCount).toBe(4);
  });

  it("does not count a review concurrent with implementation as reviewing the latest changes", async () => {
    const goal = goalRun({
      tasksAllowed: true, roles: { "worker-id": "worker", "tester-id": "reviewer" }, members: team,
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [...work, { id: "r", assignee: "Checker", instruction: "Review the design" }] })),
        settled(envelope({ status: "completed", detail: "Done." })),
        settled(envelope({ status: "needs-input", detail: "Review still needed." })),
      ],
      dispatchWave: async (batch) => batch.map(({ bot, assignment }) => {
        expect(assignment).toContain(bot.id === "worker-id" ? "You are a Worker" : "You are this room's Reviewer");
        return { botId: bot.id, ran: true, replyText: "Done.", outcome: "settled" as const };
      }),
    });
    await goal.done;
    expect(goal.calls[2]!.instructions).toContain("have the Reviewer inspect the latest changes");
    expect(goal.finished).toEqual([{ status: "needs-input", detail: "Review still needed." }]);
  });

  describe("the Tester's and Reviewer's report lines", () => {
    const reviewTeam = [...team, { id: "review-id", name: "Review" }];
    const reviewRoles: Record<string, TeamRole> = { ...roles, "review-id": "reviewer" };

    it("holds completion once on a blocking finding, names its owner, and records a deliberate set-aside", async () => {
      const goal = goalRun({ tasksAllowed: true, roles: reviewRoles, members: reviewTeam, steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: work })),
        settled("Added src/checkout.tsx."),
        settled("Build and tests ran.\nVERDICT: PASS"),
        settled("FINDING: block t1 src/checkout.tsx:12 — the total ignores the discount\nFINDING: note t1 src/checkout.tsx:3 — unused import\nREVIEW: BLOCK 1"),
        settled(envelope({ status: "completed", detail: "Done." })),
        settled(envelope({ status: "completed", detail: "Done; discounts are out of scope for this goal." })),
      ] });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "worker-id", "tester-id", "review-id", "lead-id", "lead-id"]);
      expect(goal.calls[3]!.instructions).toContain("- t1 · Builder · Add the checkout page · src/checkout.tsx");
      expect(goal.calls[4]!.instructions).toContain("reported blocking findings: src/checkout.tsx: the total ignores the discount (task t1, Builder)");
      expect(goal.calls[4]!.instructions).not.toContain("unused import");
      expect(goal.calls[5]!.instructions).toContain("Not done yet: the Reviewer's latest review has blocking findings");
      expect(goal.notes).toContainEqual(expect.stringContaining("set aside: Done; discounts are out of scope"));
      expect(goal.finished).toEqual([{ status: "completed", detail: "Done; discounts are out of scope for this goal." }]);
    });

    it("lets a fix and a clear review lift the hold", async () => {
      const goal = goalRun({ tasksAllowed: true, roles: reviewRoles, members: reviewTeam, steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: work })),
        settled("Added."), settled("VERDICT: PASS"), settled("REVIEW: BLOCK 1"),
        settled(envelope({ status: "continue", detail: "Fix", tasks: [{ id: "t2", assignee: "Builder", instruction: "Apply the discount", writes: ["src/checkout.tsx"] }] })),
        settled("Fixed."), settled("VERDICT: PASS"), settled("No problems left.\nREVIEW: CLEAR"),
        settled(envelope({ status: "completed", detail: "Checkout fixed." })),
      ] });
      await goal.done;
      expect(goal.calls[4]!.instructions).toContain("ended with REVIEW: BLOCK without listing the findings");
      expect(goal.calls.some((call) => call.instructions.includes("Not done yet"))).toBe(false);
      expect(goal.finished).toEqual([{ status: "completed", detail: "Checkout fixed." }]);
    });

    it("asks once again for a missing VERDICT or REVIEW line instead of counting the run", async () => {
      const goal = goalRun({ tasksAllowed: true, roles: reviewRoles, members: reviewTeam, steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: work })),
        settled("Added."), settled("Looks fine to me."), settled("Seems fine."),
        settled(envelope({ status: "completed", detail: "Done." })),
        settled(envelope({ status: "needs-input", detail: "Checks still owed." })),
      ] });
      await goal.done;
      expect(goal.calls[4]!.instructions).toContain("Checker (Tester) did not end with a VERDICT line");
      expect(goal.calls[4]!.instructions).toContain("Review (Reviewer) did not end with a REVIEW line");
      expect(goal.calls[4]!.instructions).not.toContain("reported no verdict");
      expect(goal.calls[5]!.instructions).toContain("have the Reviewer inspect the latest changes");
    });

    it("gives the Tester and Reviewer tasks the Lead wrote itself the Lead's plan, by member name", async () => {
      const goal = goalRun({ tasksAllowed: true, roles: reviewRoles, members: reviewTeam, steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [
          { id: "t1", assignee: "worker-id", instruction: "Add the checkout page", writes: ["src/checkout.tsx"] },
          { id: "r1", assignee: "review-id", instruction: "Review git diff of src/", dependsOn: ["t1"] },
          { id: "c1", assignee: "tester-id", instruction: "Run npm test", dependsOn: ["t1"] },
        ] })),
        settled("Added."), settled("FINDING: note t1 src/checkout.tsx:3 — unused import\nREVIEW: CLEAR"), settled("VERDICT: PASS"),
        settled(envelope({ status: "completed", detail: "Done." })),
      ] });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "worker-id", "review-id", "tester-id", "lead-id"]);
      expect(goal.calls[2]!.instructions).toContain("Review git diff of src/\nThe Lead's plan for the work you review (task · Worker · what it does · files); name the task id in each finding:\n- t1 · Builder · Add the checkout page · src/checkout.tsx");
      expect(goal.calls[3]!.instructions).toContain("Run npm test\nThe Lead's plan for the work you test (task · Worker · what it does · files):\n- t1 · Builder · Add the checkout page · src/checkout.tsx");
      expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
    });

    it("refuses a plan that has the Tester write the tests, then runs the corrected plan", async () => {
      const goal = goalRun({ tasksAllowed: true, roles: reviewRoles, members: reviewTeam, steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [
          { id: "t1", assignee: "worker-id", instruction: "Build the shop", writes: ["src/"] },
          { id: "t3", assignee: "tester-id", role: "Test engineer", instruction: "Write the tests in tests/ and run them", writes: ["tests/"], dependsOn: ["t1"] },
        ] })),
        settled(envelope({ status: "needs-input", detail: "Stop here." })),
      ] });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "lead-id"]);
      expect(goal.calls[1]!.instructions).toContain("Plan refused: task t3 for Tester Checker declares writes (tests/)");
    });

    it("names the Worker whose declared writes cover each FAIL line", async () => {
      const twoWorkers = [...team, { id: "maker-id", name: "Maker" }];
      const goal = goalRun({ tasksAllowed: true, roles: { ...roles, "maker-id": "worker" }, members: twoWorkers, steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [
          { id: "t1", assignee: "Builder", instruction: "Cart", writes: ["src/cart.ts"] },
          { id: "t2", assignee: "Maker", instruction: "Totals", writes: ["src/total.ts"] },
        ] })),
        settled("Cart done."), settled("Totals done."),
        settled("FAIL: src/total.ts:3 — the sum skips tax\nVERDICT: FAIL"),
        settled(envelope({ status: "needs-input", detail: "Stop here." })),
      ] });
      await goal.done;
      expect(goal.calls.at(-1)!.instructions).toContain("Owners by declared writes: src/total.ts → Maker (task t2)");
    });
  });

  describe("conflicts while a wave runs", () => {
    const twoWorkers = [...team, { id: "maker-id", name: "Maker" }];
    const twoRoles: Record<string, TeamRole> = { ...roles, "maker-id": "worker" };
    const plan = [
      { id: "t1", assignee: "Builder", instruction: "Cart", writes: ["src/cart.js"] },
      { id: "t2", assignee: "Maker", instruction: "Totals", writes: ["src/total.js"] },
    ];
    const changed = ["src/cart.js", "src/total.js"];
    const edits: Record<string, string[]> = { "worker-id": ["D:/w/src/cart.js"], "maker-id": ["D:/w/src/total.js", "D:/w/src/cart.js"] };
    const watched = (overrides: { steer?: boolean; waveMs?: number; watchMs?: number }) => {
      const steered: Array<{ botId: string; text: string }> = [];
      const goal = goalRun({
        tasksAllowed: true, roles: twoRoles, members: twoWorkers, watchMs: overrides.watchMs ?? 5,
        snapshotWrites: async () => new Map(),
        writesOutside: async (_before, declared) => changed.filter((file) => !declared.includes(file)),
        laneEdits: async (botId) => edits[botId] ?? [],
        steerLane: async (botId, text) => { steered.push({ botId, text }); return overrides.steer ?? true; },
        dispatchWave: (batch) => new Promise((resolve) => setTimeout(() => resolve(batch.map(({ bot }) => ({ botId: bot.id, ran: true, replyText: "Done.", outcome: "settled" as const }))), overrides.waveMs ?? 40)),
        steps: [
          settled(envelope({ status: "continue", detail: "Plan", tasks: plan })),
          settled(envelope({ status: "needs-input", detail: "Stop." })),
        ],
      });
      return { goal, steered };
    };

    it("tells the later Worker's running turn to stop, notes it in the room at once, and asks the Lead to evaluate", async () => {
      const { goal, steered } = watched({});
      await goal.done;
      expect(steered).toEqual([{ botId: "maker-id", text: "Harness note: src/cart.js belongs to task t1 (Builder) in this plan. Stop editing it, finish your own files, and tell Lead in your reply what you needed changed there." }]);
      expect(goal.conflicts).toEqual([expect.objectContaining({ file: "src/cart.js", ownerTask: "t1", ownerBotId: "worker-id", otherTask: "t2", otherBotId: "maker-id", steered: true })]);
      expect(goal.notes).toContain("Conflict: Maker (task t2) edited src/cart.js, which belongs to Builder (task t1); told to stop");
      expect(goal.calls.at(-1)!.instructions).toContain("Conflicts during this wave: Maker (task t2) edited src/cart.js, which belongs to Builder (task t1) and was told to stop. Evaluate each: give the file to one Worker to merge both changes, change the plan, or ask the person.");
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "lead-id"]);
    });

    it("still reports the conflict to the Lead when the engine cannot take words mid-turn", async () => {
      const { goal } = watched({ steer: false });
      await goal.done;
      expect(goal.conflicts).toEqual([expect.objectContaining({ file: "src/cart.js", steered: false })]);
      expect(goal.notes).toContain("Conflict: Maker (task t2) edited src/cart.js, which belongs to Builder (task t1)");
    });

    it("finds a conflict after a wave that ended before the first look, without steering a finished turn", async () => {
      const { goal, steered } = watched({ waveMs: 1, watchMs: 60_000 });
      await goal.done;
      expect(steered).toEqual([]);
      expect(goal.conflicts).toEqual([expect.objectContaining({ file: "src/cart.js", steered: false })]);
    });
  });

  describe("the run's brief", () => {
    const reviewTeam = [...team, { id: "review-id", name: "Review" }];
    const reviewRoles: Record<string, TeamRole> = { ...roles, "review-id": "reviewer" };
    const brief = { goal: "Ship checkout", inScope: ["cart and checkout"], outOfScope: ["payments"], acceptance: ["Totals match SPEC.md"], constraints: ["no new dependencies"], openQuestions: [] };

    it("is asked for once when the first plan has none, then the run goes on without it", async () => {
      const goal = goalRun({ tasksAllowed: true, roles, members: team, steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: work, brief: null })),
        settled(envelope({ status: "continue", detail: "Plan", tasks: work, brief: null })),
        settled("Added."), settled("VERDICT: PASS"),
        settled(envelope({ status: "completed", detail: "Done." })),
      ] });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "lead-id", "worker-id", "tester-id", "lead-id"]);
      expect(goal.calls[0]!.instructions).toContain("Your first plan carries the run's brief");
      expect(goal.calls[1]!.instructions).toContain("Plan refused: the first plan carries the run's brief");
      expect(goal.briefs).toEqual([]);
      expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
    });

    it("is kept on the card, given to every later Lead turn, and its acceptance checks go to the Tester and Reviewer", async () => {
      const goal = goalRun({ tasksAllowed: true, roles: reviewRoles, members: reviewTeam, steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: work, brief })),
        settled("Added."), settled("VERDICT: PASS"), settled("REVIEW: CLEAR"),
        settled(envelope({ status: "completed", detail: "Done." })),
      ] });
      await goal.done;
      expect(goal.briefs).toEqual([brief]);
      expect(goal.calls[4]!.instructions).toContain("The brief this run is held to:\nGoal: Ship checkout\nIn scope:\n- cart and checkout\nOut of scope:\n- payments\nAcceptance:\n- Totals match SPEC.md\nConstraints:\n- no new dependencies");
      expect(goal.calls[4]!.instructions).not.toContain("Your first plan carries the run's brief");
      expect(goal.calls[2]!.instructions).toContain("Acceptance checks from the run's brief:\n- Totals match SPEC.md");
      expect(goal.calls[3]!.instructions).toContain("Acceptance checks from the run's brief:\n- Totals match SPEC.md");
      expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
    });

    it("stops at needs-input with its open questions before any work starts", async () => {
      const goal = goalRun({ tasksAllowed: true, roles, members: team, steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: work, brief: { ...brief, openQuestions: ["Which currency?", "Is shipping free?"] } })),
      ] });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id"]);
      expect(goal.finished).toEqual([{ status: "needs-input", detail: "Questions before work starts: 1) Which currency? 2) Is shipping free?" }]);
    });

    it("is not asked for in a room without roles or for a single next step", async () => {
      const goal = goalRun({ tasksAllowed: true, members: team, steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [{ id: "t1", assignee: "Builder", instruction: "Add it" }], brief: null })),
        settled("Added."),
        settled(envelope({ status: "completed", detail: "Done." })),
      ] });
      await goal.done;
      expect(goal.calls[0]!.instructions).not.toContain("run's brief");
      expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
    });
  });

  describe("a Tester or Reviewer before any Worker has worked", () => {
    it("counts the checker-first refusal toward the shared plan-refusal limit", async () => {
      const goal = goalRun({
        tasksAllowed: true, roles, members: team,
        steps: [
          settled(envelope({ status: "continue", next: "Checker", instruction: "Run the tests", detail: "Baseline" })),
          settled(envelope({ status: "continue", next: "Builder", instruction: "Build it", detail: "Work" })),
          settled(envelope({ status: "continue", next: "Builder", instruction: "Build it", detail: "Work" })),
        ],
      });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "lead-id", "lead-id"]);
      expect(goal.calls[1]!.instructions).toContain("Plan the Worker tasks first");
      expect(goal.calls[2]!.instructions).toContain("Plan required");
      expect(goal.finished).toEqual([{ status: "blocked", detail: expect.stringContaining("plan kept omitting Worker task declarations") }]);
    });

    it("refuses a first next step to the Tester once, then accepts the same step", async () => {
      const goal = goalRun({
        tasksAllowed: false, roles, members: team,
        steps: [
          settled(envelope({ status: "continue", next: "Checker", instruction: "Run the tests", detail: "Baseline" })),
          settled(envelope({ status: "continue", next: "Checker", instruction: "Run the tests", detail: "Baseline" })),
          settled("Ran.\nVERDICT: PASS"),
          settled(envelope({ status: "needs-input", detail: "Baseline taken." })),
        ],
      });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "lead-id", "tester-id", "lead-id"]);
      expect(goal.calls[1]!.instructions).toContain("Plan the Worker tasks first");
    });

    it("refuses a plan with only Reviewer tasks once, then accepts it", async () => {
      const reviewTeam = [...team, { id: "reviewer-id", name: "Reviewer" }];
      const reviewRoles: Record<string, TeamRole> = { ...roles, "reviewer-id": "reviewer" };
      const reviewOnly = [{ id: "r1", assignee: "Reviewer", instruction: "Review the current code" }];
      const goal = goalRun({
        tasksAllowed: true, roles: reviewRoles, members: reviewTeam,
        steps: [
          settled(envelope({ status: "continue", detail: "Plan", tasks: reviewOnly })),
          settled(envelope({ status: "continue", detail: "Plan", tasks: reviewOnly })),
          settled("Reviewed."),
          settled(envelope({ status: "needs-input", detail: "Baseline taken." })),
        ],
      });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "lead-id", "reviewer-id", "lead-id"]);
      expect(goal.calls[1]!.instructions).toContain("Plan the Worker tasks first");
    });

    it("leaves a plan with Worker and Tester tasks alone", async () => {
      const goal = goalRun({
        tasksAllowed: true, roles, members: team,
        steps: [
          settled(envelope({ status: "continue", detail: "Plan", tasks: [...work, { id: "c1", assignee: "Checker", instruction: "Run the tests", dependsOn: ["t1"] }] })),
          settled("Built."),
          settled("Ran.\nVERDICT: PASS"),
          settled(envelope({ status: "completed", detail: "Done." })),
        ],
      });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "worker-id", "tester-id", "lead-id"]);
      expect(goal.calls[1]!.instructions).not.toContain("Plan the Worker tasks first");
    });

    it("leaves a room with no Worker alone", async () => {
      const goal = goalRun({
        tasksAllowed: false, roles: { "lead-id": "lead", "tester-id": "tester" }, members: team,
        steps: [
          settled(envelope({ status: "continue", next: "Checker", instruction: "Run the tests", detail: "Baseline" })),
          settled("Ran.\nVERDICT: PASS"),
          settled(envelope({ status: "completed", detail: "Done." })),
        ],
      });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "tester-id", "lead-id"]);
    });

    it("leaves a room without roles alone", async () => {
      const goal = goalRun({
        tasksAllowed: false, members: team,
        steps: [
          settled(envelope({ status: "continue", next: "Checker", instruction: "Run the tests", detail: "Baseline" })),
          settled("Ran."),
          settled(envelope({ status: "completed", detail: "Done." })),
        ],
      });
      await goal.done;
      expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "tester-id", "lead-id"]);
    });
  });
});

describe("a member that runs out of AI usage in a goal run", () => {
  const team = [{ id: "lead-id", name: "Lead" }, { id: "maple-id", name: "Maple" }, { id: "clover-id", name: "Clover" }, { id: "tester-id", name: "Checker" }];
  const roles: Record<string, TeamRole> = { "lead-id": "lead", "maple-id": "worker", "clover-id": "worker", "tester-id": "tester" };
  const limit: GoalStepResult = { ran: true, replyText: "", outcome: "provider_failed", stopReason: "This OpenCode account has reached its usage limit (OpenCode says: \"Free usage limit reached\")." };
  const ui = [{ id: "t1", assignee: "Maple", instruction: "Build the UI", writes: ["web/ui.tsx"] }];

  it("is not retried, leaves the run, and the Lead is told to give its task to a free member of the same role", async () => {
    const goal = goalRun({
      tasksAllowed: true, roles, members: team,
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: ui })),
        limit,
        settled(envelope({ status: "continue", detail: "Again", tasks: ui })),
        settled(envelope({ status: "continue", detail: "Moved", tasks: [{ ...ui[0]!, assignee: "Clover" }] })),
        settled("Built web/ui.tsx."),
        settled("All good.\nVERDICT: PASS"),
        settled(envelope({ status: "completed", detail: "UI built." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "maple-id", "lead-id", "lead-id", "clover-id", "tester-id", "lead-id"]);
    expect(goal.calls[2]!.instructions).toContain('Maple ran out of AI usage and is out of this run. Give its task "Build the UI" to Clover (clover-id).');
    expect(goal.calls[3]!.instructions).toContain("task t1 goes to Maple, whose AI ran out of usage in this run");
    expect(goal.finished).toEqual([{ status: "completed", detail: "UI built." }]);
  });

  it("blocks the run with the reason when no one of that role is left", async () => {
    const goal = goalRun({
      tasksAllowed: true, roles: { "lead-id": "lead", "maple-id": "worker", "clover-id": "tester" }, members: team.slice(0, 3),
      steps: [settled(envelope({ status: "continue", detail: "Plan", tasks: ui })), limit],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "blocked", detail: "Maple ran out of AI usage and no other worker can take its work." }]);
  });

  it("still fails an ordinary provider failure as before", async () => {
    const goal = goalRun({
      tasksAllowed: true, roles, members: team,
      steps: [settled(envelope({ status: "continue", detail: "Plan", tasks: ui })), { ran: true, replyText: "", outcome: "provider_failed", stopReason: "socket hang up" }],
    });
    await goal.done;
    expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "maple-id", "maple-id"]);
    expect(goal.finished).toEqual([{ status: "failed", detail: expect.stringContaining("Maple could not return a result") }]);
  });
});

describe("project preparation and baseline", () => {
  it("runs setup then baseline before the first bot, retains old failures in all turns, and still requires passing final checks", async () => {
    const commands: string[] = [];
    let checks = 0;
    const goal = goalRun({
      members: [{ id: "lead", name: "Lead" }, { id: "worker", name: "Worker" }],
      projectProfile: { instructions: "Follow AGENTS.md", moduleMap: "src: service", protectedPaths: ["vendor"], setup: [{ id: "deps", command: "npm ci" }] },
      verify: [{ id: "tests", command: "npm test" }],
      runVerify: async (command) => {
        commands.push(command.id);
        return { id: command.id, exitCode: command.id === "tests" && ++checks < 3 ? 1 : 0, output: "old failure" };
      },
      steps: [
        settled(envelope({ status: "continue", next: "Worker", instruction: "Repair", detail: "Work" })),
        settled("Fixed."),
        settled(envelope({ status: "completed", detail: "Done" })),
        settled(envelope({ status: "completed", detail: "Done after repair" })),
      ],
    });
    await goal.done;
    expect(commands).toEqual(["deps", "tests", "tests", "tests"]);
    expect(goal.baselines[0]).toMatchObject({ setup: [{ id: "deps", exitCode: 0 }], checks: [{ id: "tests", exitCode: 1 }] });
    for (const call of goal.calls) {
      expect(call.instructions).toContain("Follow AGENTS.md");
      expect(call.instructions).toContain("tests: FAIL, exit 1");
    }
    expect(goal.calls[3]!.instructions).toContain("The room's own checks failed");
    expect(goal.notes).toContain("Project baseline: 0/1 checks passed; already failing: tests");
    expect(goal.finished).toEqual([{ status: "completed", detail: "Done after repair" }]);
    expect(goal.run.turnCount).toBe(4);
  });

  it("passes the same baseline to runtime-dispatched Workers, Tester and Reviewer", async () => {
    const assignments: string[] = [];
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead", name: "Lead" }, { id: "worker", name: "Worker" }, { id: "tester", name: "Tester" }, { id: "reviewer", name: "Reviewer" }],
      roles: { lead: "lead", worker: "worker", tester: "tester", reviewer: "reviewer" },
      projectProfile: { moduleMap: "src: service" },
      verify: [{ id: "build", command: "npm run build", expectExit: 2 }],
      runVerify: async (command) => ({ id: command.id, exitCode: 2, output: "ok" }),
      dispatchWave: async (batch) => batch.map((entry) => {
        assignments.push(entry.assignment);
        return { botId: entry.bot.id, ran: true, outcome: "settled", replyText: entry.bot.id === "tester" ? "VERDICT: PASS" : entry.bot.id === "reviewer" ? "REVIEW: CLEAR" : "Done" };
      }),
      steps: [settled(envelope({ status: "continue", tasks: [{ id: "w", assignee: "Worker", instruction: "Repair", writes: ["src/"] }] })), settled(envelope({ status: "completed", detail: "Done" }))],
    });
    await goal.done;
    expect(assignments).toHaveLength(3);
    expect(assignments.every((assignment) => assignment.includes("build: PASS, exit 2, expected 2") && assignment.includes("src: service"))).toBe(true);
    expect(goal.finished[0]!.status).toBe("completed");
  });

  it("blocks before bot turns on setup failure and saves the failed setup without running verify", async () => {
    const commands: string[] = [];
    const goal = goalRun({
      projectProfile: { setup: [{ id: "deps", command: "npm ci" }] },
      verify: [{ id: "tests", command: "npm test" }],
      runVerify: async (command) => { commands.push(command.id); return { id: command.id, exitCode: null, output: "timeout" }; },
      steps: [],
    });
    await goal.done;
    expect(commands).toEqual(["deps"]);
    expect(goal.calls).toHaveLength(0);
    expect(goal.baselines[0]).toMatchObject({ setup: [{ id: "deps", exitCode: null }], checks: [] });
    expect(goal.finished[0]).toMatchObject({ status: "blocked", detail: expect.stringContaining("Project setup deps failed") });
  });

  it("blocks profiles without a folder and does not start commands", async () => {
    const goal = goalRun({ projectProfile: {}, projectRefusal: "no working folder", steps: [] });
    await goal.done;
    expect(goal.calls).toHaveLength(0);
    expect(goal.baselines).toHaveLength(0);
    expect(goal.finished).toEqual([{ status: "blocked", detail: "no working folder" }]);
  });

  it("does not start a bot or another command if Stop arrives during preparation", async () => {
    let stopped = false;
    const goal = goalRun({
      projectProfile: {}, verify: [{ id: "tests", command: "npm test" }, { id: "lint", command: "npm run lint" }],
      runVerify: async (command) => { stopped = true; return { id: command.id, exitCode: 0, output: "" }; },
      cancelled: () => stopped, steps: [],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(0);
    expect(goal.finished).toHaveLength(0);
    expect(goal.baselines).toHaveLength(0);
  });
});

describe("room verify checks and tester writes", () => {
  const planTask = (assignee: string, id = "t1", instruction = "Do it") => ({ id, assignee, instruction });

  it("the server runs the room's checks itself; a failing check turns the completion into a fix round", async () => {
    const runCommands: string[] = [];
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "worker-id", name: "Worker" }],
      verify: [{ id: "tests", command: "pnpm test", expectExit: 0 }],
      runVerify: async (command) => {
        runCommands.push(command.command);
        return { id: command.id, exitCode: 1, output: "3 tests failed" };
      },
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [planTask("Worker")] })),
        settled("Done."),
        settled(envelope({ status: "completed", detail: "All good." })),
        settled(envelope({ status: "needs-input", detail: "I need the failing test names." })),
      ],
    });
    await goal.done;
    expect(runCommands).toEqual(["pnpm test"]);
    expect(goal.calls).toHaveLength(4); // coordinator, worker, coordinator (verify fails), coordinator again
    expect(goal.run.turnCount).toBe(4);
    expect(goal.calls[3]!.instructions).toContain("The room's own checks failed");
    expect(goal.finished).toEqual([{ status: "needs-input", detail: "I need the failing test names." }]);
  });

  it("a room with checks but no folder to run them in blocks before any turn", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "worker-id", name: "Worker" }],
      verify: [{ id: "tests", command: "pnpm test" }],
      verifyRefusal: "no working folder",
      steps: [settled(envelope({ status: "completed", detail: "All good." }))],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(0);
    expect(goal.finished).toEqual([{ status: "blocked", detail: "no working folder" }]);
  });

  it("a passing check completes the run after the tester's word", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "worker-id", name: "Worker" }],
      verify: [{ id: "build", command: "pnpm build" }],
      runVerify: async (command) => ({ id: command.id, exitCode: 0, output: "" }),
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [planTask("Worker")] })),
        settled("Done."),
        settled(envelope({ status: "completed", detail: "All good." })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "completed", detail: "All good." }]);
  });

  it("checks that keep failing after the fix-round cap block the run", async () => {
    let rounds = 0;
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "worker-id", name: "Worker" }],
      verify: [{ id: "tests", command: "pnpm test" }],
      runVerify: async (command) => {
        rounds += 1;
        return { id: command.id, exitCode: 1, output: `still failing ${rounds}` };
      },
      steps: Array.from({ length: 6 }, (_, index) => settled(envelope({ status: "completed", detail: `Attempt ${index}` }))),
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "blocked", detail: expect.stringContaining("kept failing after 3 fix rounds") }]);
    expect(rounds).toBe(4);
  });

  it("a Tester that wrote files outside its report region has its PASS voided", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "tester-id", name: "Tester" }],
      roles: { "tester-id": "tester" },
      snapshotWrites: async () => new Map(),
      writesOutside: async () => ["src/tweaked.ts"],
      steps: [
        settled(envelope({ status: "continue", next: "Tester", instruction: "Test it", detail: "Testing" })),
        settled("All good.\nVERDICT: PASS"),
        settled(envelope({ status: "needs-input", detail: "I will fix the file the tester touched." })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "needs-input", detail: "I will fix the file the tester touched." }]);
    expect(goal.calls[2]!.instructions).toContain("changed files outside its report region");
    expect(goal.calls[2]!.instructions).toContain("its PASS does not count");
  });

  it("a Tester whose writes stay in its report region keeps its PASS", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "tester-id", name: "Tester" }],
      roles: { "tester-id": "tester" },
      snapshotWrites: async () => new Map(),
      writesOutside: async () => [],
      steps: [
        settled(envelope({ status: "continue", next: "Tester", instruction: "Test it", detail: "Testing" })),
        settled("All good.\nVERDICT: PASS"),
        settled(envelope({ status: "completed", detail: "Done." })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
  });

  it("the vendor rule refuses a plan whose Reviewer shares a Worker's vendor", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [
        { id: "lead-id", name: "Lead" },
        { id: "worker-id", name: "Worker" },
        { id: "reviewer-id", name: "Reviewer" },
      ],
      roles: { "worker-id": "worker", "reviewer-id": "reviewer" },
      vendorOf: (botId) => (botId === "worker-id" ? "anthropic" : "anthropic"),
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [
          { id: "t1", assignee: "Worker", instruction: "Build it", writes: ["page.tsx"] },
          { id: "t2", assignee: "Reviewer", instruction: "Review it", dependsOn: ["t1"] },
        ] })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "blocked", detail: expect.stringContaining("same model vendor (anthropic)") }]);
  });

  it("a Reviewer on another vendor passes the plan check", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [
        { id: "lead-id", name: "Lead" },
        { id: "worker-id", name: "Worker" },
        { id: "reviewer-id", name: "Reviewer" },
      ],
      roles: { "worker-id": "worker", "reviewer-id": "reviewer" },
      vendorOf: (botId) => (botId === "worker-id" ? "anthropic" : "openai"),
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [
          { id: "t1", assignee: "Worker", instruction: "Build it", writes: ["page.tsx"] },
          { id: "t2", assignee: "Reviewer", instruction: "Review it", dependsOn: ["t1"] },
        ] })),
        settled("Built."),
        settled("Reviewed.\nREVIEW: CLEAR"),
        settled(envelope({ status: "completed", detail: "Done." })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
  });

  it("an unknown vendor is refused, never guessed to be different", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [
        { id: "lead-id", name: "Lead" },
        { id: "worker-id", name: "Worker" },
        { id: "reviewer-id", name: "Reviewer" },
      ],
      roles: { "worker-id": "worker", "reviewer-id": "reviewer" },
      vendorOf: (botId) => (botId === "worker-id" ? "anthropic" : "unknown"),
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [
          { id: "t1", assignee: "Worker", instruction: "Build it", writes: ["page.tsx"] },
          { id: "t2", assignee: "Reviewer", instruction: "Review it", dependsOn: ["t1"] },
        ] })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "blocked", detail: expect.stringContaining("unknown model vendor") }]);
  });
});

describe("research room rules", () => {
  const researchPlan = (tasks: Array<Record<string, unknown>>) => settled(envelope({ status: "continue", detail: "Plan", tasks }));

  it("the pilot gate refuses a first plan larger than the goal file allows, then lets a smaller one run", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "a-id", name: "A" }, { id: "b-id", name: "B" }],
      roles: { "a-id": "worker", "b-id": "worker" },
      research: { pilotMaxTasks: 1 },
      steps: [
        researchPlan([
          { id: "t1", assignee: "A", instruction: "One", writes: ["a.txt"] },
          { id: "t2", assignee: "B", instruction: "Two", writes: ["b.txt"] },
        ]),
        researchPlan([
          { id: "t3", assignee: "A", instruction: "One again", writes: ["a.txt"] },
        ]),
        settled("Done."),
        settled(envelope({ status: "completed", detail: "Pilot held." })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "completed", detail: "Pilot held." }]);
    expect(goal.calls[1]!.instructions).toContain("the pilot plan may schedule at most 1 task(s)");
  });

  it("the GPU handoff lets a completed goal finish once its files are present", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "worker-id", name: "Worker" }],
      roles: { "worker-id": "worker" },
      research: { handoffExpectsFiles: ["results/metrics.json"] },
      missingHandoffFiles: async () => [],
      steps: [
        researchPlan([{ id: "t1", assignee: "Worker", instruction: "Prepare", writes: ["run.py"] }]),
        settled("Prepared."),
        settled(envelope({ status: "completed", detail: "Handed off." })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "completed", detail: "Handed off." }]);
  });

  it("missing handoff files turn a completed call into needs-input with the file names", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "worker-id", name: "Worker" }],
      roles: { "worker-id": "worker" },
      research: { handoffExpectsFiles: ["results/metrics.json"] },
      missingHandoffFiles: async () => ["results/metrics.json"],
      steps: [
        researchPlan([{ id: "t1", assignee: "Worker", instruction: "Prepare", writes: ["run.py"] }]),
        settled("Prepared."),
        settled(envelope({ status: "completed", detail: "Handed off." })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{
      status: "needs-input",
      detail: expect.stringContaining("missing files the goal file expects: results/metrics.json"),
    }]);
  });

  it("held-out paths mentioned in a member's event log are reported after the fact", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "worker-id", name: "Worker" }],
      roles: { "worker-id": "worker" },
      research: { heldOutPaths: ["eval/heldout.json"] },
      heldOutTouched: async (botId) => (botId === "worker-id" ? ["eval/heldout.json"] : []),
      steps: [
        researchPlan([{ id: "t1", assignee: "Worker", instruction: "Prepare", writes: ["run.py"] }]),
        settled("Prepared."),
        settled(envelope({ status: "completed", detail: "Done." })),
      ],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
    expect(goal.notes.some((note) => note.includes("touched held-out paths") && note.includes("eval/heldout.json"))).toBe(true);
  });
  it("the pilot gate keeps refusing an oversized first plan until a plan within it is accepted", async () => {
    const big = researchPlan([
      { id: "t1", assignee: "A", instruction: "One", writes: ["a.txt"] },
      { id: "t2", assignee: "B", instruction: "Two", writes: ["b.txt"] },
    ]);
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "a-id", name: "A" }, { id: "b-id", name: "B" }],
      roles: { "a-id": "worker", "b-id": "worker" },
      research: { pilotMaxTasks: 1 },
      steps: [big, big, big],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "blocked", detail: expect.stringContaining("the pilot plan may schedule at most 1 task(s)") }]);
  });

  it("budget already spent by earlier runs of the same goal file stops the run before any turn", async () => {
    const goal = goalRun({
      members: [{ id: "lead-id", name: "Lead" }],
      research: { budgetWallMinutes: 30, budgetSpentMs: 31 * 60_000 },
      steps: [settled(envelope({ status: "completed", detail: "Done." }))],
    });
    await goal.done;
    expect(goal.calls).toHaveLength(0);
    expect(goal.finished).toEqual([{ status: "blocked", detail: expect.stringContaining("across every run of this goal file") }]);
  });

  it("a metric below the threshold keeps the run going and is recorded; one at the threshold completes it", async () => {
    const readings = [0.61, 0.74];
    const recorded: number[] = [];
    const goal = goalRun({
      members: [{ id: "lead-id", name: "Lead" }],
      research: { metric: { threshold: 0.72, direction: "at-least" } },
      readMetric: async () => ({ ok: true, value: readings.shift()! }),
      recordMetric: (value) => recorded.push(value),
      steps: [settled(envelope({ status: "completed", detail: "Done." }))],
    });
    await goal.done;
    expect(recorded).toEqual([0.61, 0.74]);
    expect(goal.calls[1]!.instructions).toContain("the metric is 0.61, the goal file needs at-least 0.72");
    expect(goal.finished).toEqual([{ status: "completed", detail: "Done." }]);
  });

  it("an unreadable metric never completes the goal", async () => {
    const goal = goalRun({
      members: [{ id: "lead-id", name: "Lead" }],
      research: { metric: { threshold: 0.72, direction: "at-least" } },
      readMetric: async () => ({ ok: false, reason: "results/metrics.json is missing or not valid JSON" }),
      steps: [settled(envelope({ status: "completed", detail: "Done." }))],
      cancelAfter: 3,
    });
    await goal.done;
    expect(goal.finished).toEqual([]);
    expect(goal.calls[1]!.instructions).toContain("results/metrics.json is missing");
  });

  it("experiment rounds counted across runs stop the research with a negative result", async () => {
    const goal = goalRun({
      members: [{ id: "lead-id", name: "Lead" }],
      research: { metric: { threshold: 0.72, direction: "at-least" }, maxExperimentRounds: 3, priorMetricValues: [0.5, 0.55] },
      readMetric: async () => ({ ok: true, value: 0.6 }),
      steps: [settled(envelope({ status: "completed", detail: "Done." }))],
    });
    await goal.done;
    expect(goal.finished).toEqual([{ status: "blocked", detail: expect.stringContaining("negative result: 3 experiment rounds") }]);
  });

  it("a Reviewer picked in a later turn is still held to the vendor rule against earlier Workers", async () => {
    const goal = goalRun({
      tasksAllowed: false,
      members: [{ id: "lead-id", name: "Lead" }, { id: "worker-id", name: "Worker" }, { id: "rev-id", name: "Rev" }],
      roles: { "worker-id": "worker", "rev-id": "reviewer" },
      vendorOf: () => "anthropic",
      steps: [
        settled(envelope({ status: "continue", next: "Worker", instruction: "Build a.ts", detail: "Build" })),
        settled("Built."),
        settled(envelope({ status: "continue", next: "Rev", instruction: "Review a.ts", detail: "Reviewing" })),
        settled(envelope({ status: "needs-input", detail: "Pick another reviewer." })),
      ],
    });
    await goal.done;
    expect(goal.calls.map((call) => call.bot)).toEqual(["lead-id", "worker-id", "lead-id", "lead-id"]);
    expect(goal.calls[3]!.instructions).toContain("same model vendor (anthropic) as Worker Worker");
  });

  it("an Evaluator that wrote outside its report region has its results discounted", async () => {
    const goal = goalRun({
      tasksAllowed: true,
      members: [{ id: "lead-id", name: "Lead" }, { id: "eval-id", name: "Eve" }, { id: "tester-id", name: "Tess" }],
      roles: { "eval-id": "evaluator", "tester-id": "tester" },
      snapshotWrites: async () => new Map(),
      writesOutside: async () => ["results/metrics.json"],
      steps: [
        settled(envelope({ status: "continue", next: "Eve", instruction: "Evaluate", detail: "Evaluating" })),
        settled("Accuracy 0.9"),
        settled(envelope({ status: "needs-input", detail: "Stop." })),
      ],
    });
    await goal.done;
    expect(goal.calls[2]!.instructions).toContain("(Evaluator) changed files outside its report region (results/metrics.json)");
  });
});

