import { describe, expect, it } from "vitest";
import type { TeamRole } from "../shared/team-roles.ts";
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

const envelope = (decision: Record<string, unknown>) =>
  `Update.\n${GROUP_GOAL_CONTROL_OPEN}${JSON.stringify(decision)}${GROUP_GOAL_CONTROL_CLOSE}`;
const settled = (replyText: string): GoalStepResult => ({ ran: true, replyText, outcome: "settled" });

/** Drives the real loop with scripted steps; a step that runs counts one turn, as a claimed member turn does. */
function goalRun(options: {
  solo?: boolean;
  tasksAllowed?: boolean;
  roles?: Record<string, TeamRole>;
  members?: Array<{ id: string; name: string }>;
  steps: Array<GoalStepResult | ((call: number) => GoalStepResult)>;
  cancelAfter?: number;
  dispatchWave?: (batch: Array<{ bot: { id: string; name: string }; role?: string; assignment: string }>) => Promise<Array<{ botId: string; ran: boolean; replyText: string; outcome?: GoalStepResult["outcome"]; stopReason?: string | null }>>;
}) {
  const members = options.members ?? [{ id: "solo-id", name: "Solo" }];
  const run = { goal: "Get every test passing", turnCount: 0, maxTurns: GROUP_GOAL_MAX_TURNS, finished: false };
  const calls: Array<{ bot: string; coordinator: boolean; instructions: string }> = [];
  const finished: Array<{ status: GoalRunEnd; detail: string }> = [];
  const progress: string[] = [];
  let cancelled = false;
  const done = runGoalRun({
    run,
    coordinator: members[0]!,
    members,
    solo: options.solo,
    tasksAllowed: options.tasksAllowed,
    ...(options.roles ? { roles: options.roles } : {}),
    ...(options.dispatchWave ? { dispatchWave: options.dispatchWave } : {}),
    cancelled: () => cancelled,
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
    note: () => {},
  });
  return { done, run, calls, finished, progress };
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

  it("counts a parallel batch as one team turn and marks a Reviewer's task read-only", async () => {
    const reviewRoles: Record<string, TeamRole> = { "lead-id": "lead", "worker-id": "worker", "tester-id": "reviewer" };
    const batches: Array<Array<{ botId: string; readOnly?: boolean }>> = [];
    const goal = goalRun({
      tasksAllowed: true, roles: reviewRoles, members: team,
      steps: [
        settled(envelope({ status: "continue", detail: "Plan", tasks: [...work, { id: "r1", assignee: "Checker", instruction: "Review the design doc" }] })),
        settled(envelope({ status: "completed", detail: "Done." })),
      ],
      dispatchWave: async (batch) => {
        batches.push(batch.map((task) => ({ botId: task.bot.id, ...((task as { readOnly?: boolean }).readOnly ? { readOnly: true } : {}) })));
        return batch.map((task) => ({ botId: task.bot.id, ran: true, replyText: "ok", outcome: "settled" as const }));
      },
    });
    await goal.done;
    expect(batches).toEqual([[{ botId: "worker-id" }, { botId: "tester-id", readOnly: true }]]);
    expect(goal.run.turnCount).toBe(3);
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
