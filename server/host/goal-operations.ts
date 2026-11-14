import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import type { GroupGoalRunStatus } from "../../shared/group-goal-run.ts";
import type { ServerText } from "../../shared/server-text.ts";
import type { TeamRole } from "../../shared/team-roles.ts";
import { DATA_DIR, EVENTS_DIR } from "../config.ts";
import type { SteerOutcome } from "../contracts.ts";
import type { Coordinator } from "../coordinator.ts";
import { editedPaths } from "../edit-events.ts";
import { createGoalBranchWorkflow, GoalBranchWorkflowError } from "../goal-branch-workflow.ts";
import { GROUP_GOAL_WAIT_MAX_MS, runGoalRun } from "../group-goal-run.ts";
import type { ProviderRegistry } from "../harness/registry.ts";
import { goalWavesEnabled } from "../lead-cap.ts";
import { modelVendor } from "../model-vendor.ts";
import { OUTSIDE } from "../peer-provenance.ts";
import { latestRoomPlan } from "../room-plan.ts";
import { prepareResearchRun } from "../research-run.ts";
import type { BotRecord, GroupRecord, Store } from "../store.ts";
import { runVerifyCommand } from "../verify-run.ts";
import { writesOutside, writesSnapshot } from "../writes-audit.ts";
import { createGoalBranchRuns } from "./goal-branch-runs.ts";
import type { createGoalCards } from "./goal-cards.ts";
import type { createGoalTurns } from "./goal-turns.ts";
import type { GroupMemberBotWaitResult, GroupMemberTurnOutcome, GroupTurnOperation, GroupTurnOrchestration } from "./group-turn-types.ts";
import type { createRoomJobs } from "./room-jobs.ts";

export interface GoalOperationsDeps {
  store: Store;
  registry: ProviderRegistry;
  coordinator: Coordinator;
  roomJobs: Pick<ReturnType<typeof createRoomJobs>, "openLane">;
  goalCards: ReturnType<typeof createGoalCards>;
  goalTurns: ReturnType<typeof createGoalTurns>;
  runningTurnEngines: { has(threadId: string): boolean };
  beginGroupTurnOperation(groupId: string, threadId: string, botIds?: Iterable<string>): GroupTurnOperation;
  finishGroupTurnOperation(groupId: string, operation: GroupTurnOperation): void;
  waitForGroupMemberBot(bot: BotRecord, operation: GroupTurnOperation, onWaiting: (detail: string) => void): Promise<GroupMemberBotWaitResult>;
  updateGroupGoalRunProgress(operation: GroupTurnOperation, detail: string, text?: ServerText): void;
  finishGroupGoalRun(groupId: string, operation: GroupTurnOperation, status: Exclude<GroupGoalRunStatus, "working">, detail: string, text?: ServerText): void;
  runGroupMemberTurn(
    groupId: string, threadId: string, botId: string, hop: number, spoken?: Set<string>, cardContinuation?: string,
    onDispatchError?: (message: string) => void, isCancelled?: () => boolean, onProviderHandshakeStarted?: () => void,
    onProviderHandshakeSettled?: () => void, skillAuthoringClaim?: { claimed: boolean }, orchestration?: GroupTurnOrchestration,
  ): Promise<boolean>;
  groupProviderHandshakeStarted(operation: GroupTurnOperation): void;
  groupProviderHandshakeSettled(operation: GroupTurnOperation): void;
  roomTurnApprovalMode(bot: BotRecord, threadId: string, orchestration?: GroupTurnOrchestration): ApprovalMode;
  interruptDirectThread(botId: string, threadId: string, cause?: string): Promise<void>;
  roomLaneThreads(botId: string, roomThreadId: string): string[];
  roomRoles(room: GroupRecord | null | undefined): Record<string, TeamRole> | undefined;
  runningTurnInstance(bot: BotRecord | null | undefined, threadId: string): ReturnType<ProviderRegistry["get"]>;
}

/** Runs a room goal: its Lead and member steps, wave lanes on the runtime tree, and the goal's branches. */
export function createGoalOperations({
  store, registry, coordinator, roomJobs, goalCards, goalTurns, runningTurnEngines,
  beginGroupTurnOperation, finishGroupTurnOperation, waitForGroupMemberBot, updateGroupGoalRunProgress, finishGroupGoalRun,
  runGroupMemberTurn, groupProviderHandshakeStarted, groupProviderHandshakeSettled, roomTurnApprovalMode, interruptDirectThread,
  roomLaneThreads, roomRoles, runningTurnInstance,
}: GoalOperationsDeps) {
  /** One wave task's turn in its own group thread: the server runs one provider turn per thread, so tasks
   * beside each other each need a thread, and the settled result is appended back into the goal's thread. */
  async function runLaneGoalStep(
    args: {
      groupId: string;
      threadId: string;
      bot: BotRecord;
      operation: GroupTurnOperation;
      skillAuthoringClaim: { claimed: boolean };
      coordinator: boolean;
      instructions: string;
      lane: { threadId: string; brief: string };
      lead?: BotRecord;
    },
    run: NonNullable<GroupTurnOperation["goalRun"]>,
  ): Promise<{ ran: boolean; replyText: string; outcome?: GroupMemberTurnOutcome; stopReason?: string | null }> {
    let requested = false;
    for (;;) {
      const laneOperation = beginGroupTurnOperation(args.groupId, args.lane.threadId, [args.bot.id]);
      try {
        const availability = await waitForGroupMemberBot(args.bot, laneOperation, (detail) => {
          updateGroupGoalRunProgress(args.operation, `${detail} This goal will continue when they are available.`);
        });
        if (availability === "cancelled") return { ran: false, replyText: "", outcome: "cancelled" };
        if (availability === "unavailable") {
          return { ran: false, replyText: "", outcome: "unavailable", stopReason: `${args.bot.name} is no longer available` };
        }
        if (availability === "timed_out") {
          const minutes = Math.max(1, Math.round(GROUP_GOAL_WAIT_MAX_MS / 60_000));
          return {
            ran: false,
            replyText: "",
            outcome: "busy",
            stopReason: `${args.bot.name} stayed busy in another conversation for ${minutes} minute${minutes === 1 ? "" : "s"}`,
          };
        }
        if (run.turnCount >= run.maxTurns) return { ran: false, replyText: "" };

        if (!requested) {
          requested = true;
          store.appendMessage(args.lane.threadId, {
            role: "bot",
            kind: "text",
            from: { botId: args.lead?.id ?? args.bot.id, name: args.lead?.name ?? args.bot.name, color: args.lead?.color ?? args.bot.color },
            text: args.lane.brief,
          });
        }
        const result: GroupTurnOrchestration["result"] = {};
        let claimed = false;
        try {
          const ran = await runGroupMemberTurn(
            args.groupId,
            args.lane.threadId,
            args.bot.id,
            1,
            new Set(),
            undefined,
            undefined,
            () => args.operation.cancelled || laneOperation.cancelled,
            () => groupProviderHandshakeStarted(laneOperation),
            () => groupProviderHandshakeSettled(laneOperation),
            args.skillAuthoringClaim,
            {
              systemInstructions: args.instructions,
              followMentions: false,
              result,
              goalRunId: run.runId,
              onClaimed: () => {
                if (claimed) return;
                claimed = true;
                run.turnCount += 1;
                args.operation.botIds.add(args.bot.id);
                updateGroupGoalRunProgress(
                  args.operation,
                  `${args.bot.name} is working on team turn ${run.turnCount} of ${run.maxTurns}.`,
                );
              },
            },
          );
          // Busy here is a lost claim race, so retry in-step; a parked member is deliberately not retried.
          if (result.outcome === "busy") continue;
          if (ran && result.outcome === "settled" && result.replyText?.trim()) {
            store.appendMessage(args.threadId, {
              role: "bot",
              kind: "text",
              from: { botId: args.bot.id, name: args.bot.name, color: args.bot.color },
              text: result.replyText.trim(),
            });
          }
          return {
            ran,
            replyText: result.replyText ?? "",
            outcome: result.outcome,
            stopReason: result.stopReason,
          };
        } finally {
          args.operation.botIds.delete(args.bot.id);
        }
      } finally {
        finishGroupTurnOperation(args.groupId, laneOperation);
      }
    }
  }

  /** One wave batch dispatched through the runtime tree: each task is a work child in its own lane thread, and
   * the child's result reports back into the goal thread. The wave root replies "poll", so it settles in place
   * once the children settle and no coordinator turn runs outside the run loop. */
  async function runGoalWaveOnTree(args: {
    groupId: string;
    threadId: string;
    coordinatorBot: BotRecord;
    run: NonNullable<GroupTurnOperation["goalRun"]>;
    cancelled(): boolean;
    batch: Array<{ bot: BotRecord; role?: string; assignment: string; readOnly?: boolean; cwd?: string }>;
  }): Promise<Array<{ botId: string; ran: boolean; replyText: string; outcome?: GroupMemberTurnOutcome; stopReason?: string | null }>> {
    const idle = (botId: string, outcome: GroupMemberTurnOutcome, stopReason?: string | null) => ({ botId, ran: false, replyText: "", outcome, stopReason });
    const room = store.group(args.groupId);
    if (!room || room.dm || args.batch.length === 0) {
      return args.batch.map((task) => idle(task.bot.id, "dispatch_failed", "this goal's channel cannot open wave lanes"));
    }
    const sender = { id: args.coordinatorBot.id, name: args.coordinatorBot.name };
    const children = args.batch.map((task) => ({
      ...task,
      lane: roomJobs.openLane(room, args.threadId, task.bot.id, sender, task.assignment, task.cwd ? { cwd: task.cwd } : undefined),
      childId: undefined as string | undefined,
      refusal: undefined as string | undefined,
    }));
    const waveId = randomUUID();
    coordinator.beginTurn({
      id: waveId,
      address: { groupId: args.groupId, threadId: args.threadId, botId: args.coordinatorBot.id },
      brief: `Goal wave for: ${args.run.goal}`,
      level: roomTurnApprovalMode(args.coordinatorBot, args.threadId),
      origin: OUTSIDE,
      reply: "poll",
    });
    for (const child of children) {
      const brief = child.role ? `${child.role}: ${child.assignment}` : child.assignment;
      try {
        const { node } = coordinator.enqueue(
          { groupId: args.groupId, threadId: args.threadId, botId: args.coordinatorBot.id },
          waveId, waveId, { botId: child.bot.id, threadId: child.lane.threadId }, brief, { mode: child.readOnly ? "consult" : "work", thread: "new" },
        );
        child.childId = node.id;
      } catch (error) {
        child.refusal = error instanceof Error ? error.message : String(error);
      }
    }
    coordinator.endTurn(waveId, { ok: true, text: "goal wave dispatched" });
    const dispatched = children.filter((child) => child.childId);
    const terminal = new Set(["completed", "failed", "cancelled"]);
    const deadline = Date.now() + GROUP_GOAL_WAIT_MAX_MS;
    for (;;) {
      if (args.cancelled() || dispatched.every((child) => terminal.has(coordinator.node(child.childId!)?.status ?? ""))) break;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (args.cancelled()) {
      for (const child of dispatched) void interruptDirectThread(child.bot.id, child.lane.threadId);
    }
    return children.map((child) => {
      const node = child.childId ? coordinator.node(child.childId) : undefined;
      if (!node) return idle(child.bot.id, "dispatch_failed", child.refusal);
      if (node.status === "completed") return { botId: child.bot.id, ran: true, replyText: node.result ?? "", outcome: "settled" as const };
      if (node.status === "cancelled") return idle(child.bot.id, "cancelled", "the wave was stopped");
      if (node.status === "failed") {
        return { botId: child.bot.id, ran: true, replyText: node.result ?? "", outcome: "provider_failed" as const, stopReason: node.outcomeDetail ?? node.result.split("\n", 1)[0]?.slice(0, 120) };
      }
      return idle(child.bot.id, "busy", `${child.bot.name} has not finished the assignment`);
    });
  }

  async function runGroupGoalStep(args: {
    groupId: string;
    threadId: string;
    bot: BotRecord;
    operation: GroupTurnOperation;
    skillAuthoringClaim: { claimed: boolean };
    coordinator: boolean;
    instructions: string;
    lead?: BotRecord;
    lane?: { threadId: string; brief: string };
    cwd?: string;
  }): Promise<{ ran: boolean; replyText: string; outcome?: GroupMemberTurnOutcome; stopReason?: string | null }> {
    const run = args.operation.goalRun;
    if (!run || args.operation.cancelled || run.turnCount >= run.maxTurns) {
      return { ran: false, replyText: "" };
    }
    if (args.lane) return runLaneGoalStep({ ...args, lane: args.lane }, run);
    for (;;) {
      const availability = await waitForGroupMemberBot(args.bot, args.operation, (detail) => {
        updateGroupGoalRunProgress(args.operation, `${detail} This goal will continue when they are available.`);
      });
      if (availability === "cancelled") return { ran: false, replyText: "", outcome: "cancelled" };
      if (availability === "unavailable") {
        return { ran: false, replyText: "", outcome: "unavailable", stopReason: `${args.bot.name} is no longer available` };
      }
      if (availability === "timed_out") {
        const minutes = Math.max(1, Math.round(GROUP_GOAL_WAIT_MAX_MS / 60_000));
        return {
          ran: false,
          replyText: "",
          outcome: "busy",
          stopReason: `${args.bot.name} stayed busy in another conversation for ${minutes} minute${minutes === 1 ? "" : "s"}`,
        };
      }
      if (run.turnCount >= run.maxTurns) return { ran: false, replyText: "" };

      const result: GroupTurnOrchestration["result"] = {};
      let claimed = false;
      const coordinatorTurn = args.coordinator ? goalTurns.begin(args.threadId) : undefined;
      try {
        const ran = await runGroupMemberTurn(
          args.groupId,
          args.threadId,
          args.bot.id,
          run.turnCount === 0 ? 0 : 1,
          new Set(),
          undefined,
          undefined,
          () => args.operation.cancelled,
          () => groupProviderHandshakeStarted(args.operation),
          () => groupProviderHandshakeSettled(args.operation),
          args.skillAuthoringClaim,
          {
            systemInstructions: args.instructions,
            cwd: args.cwd,
            followMentions: false,
            result,
            goalRunId: run.runId,
            onClaimed: () => {
              if (claimed) return;
              claimed = true;
              run.turnCount += 1;
              args.operation.botIds.add(args.bot.id);
              updateGroupGoalRunProgress(
                args.operation,
                `${args.bot.name} is working on team turn ${run.turnCount} of ${run.maxTurns}.`,
              );
            },
            onTurnStarted: (turnId) => {
              if (coordinatorTurn && !coordinatorTurn.turnId) coordinatorTurn.turnId = turnId;
            },
          },
        );
        // Busy here is a lost claim race, so retry in-step; a parked member is deliberately not retried.
        if (result.outcome === "busy") continue;
        return {
          ran,
          replyText: result.replyText ?? "",
          outcome: result.outcome,
          stopReason: result.stopReason,
        };
      } finally {
          // An idle waiter must never redirect the bot's Stop button away from unrelated direct work.
        args.operation.botIds.delete(args.bot.id);
        if (coordinatorTurn) goalTurns.end(args.threadId, coordinatorTurn, result.outcome);
      }
    }
  }

  const goalBranchRuns = createGoalBranchRuns({ store, dataDir: DATA_DIR, release: async (groupId, threadId) => {
    const threads = [threadId, ...(store.group(groupId)?.memberIds ?? []).flatMap((id) => roomLaneThreads(id, threadId))];
    for (const thread of threads) for (const instance of registry.instances()) {
      if (instance.adapter.releaseIdleThread && !await instance.adapter.releaseIdleThread(thread)) throw new Error("A goal engine still holds this worktree; wait for its turn to stop before deciding");
    }
  } });

  async function runGroupGoalOperation(args: {
    groupId: string;
    threadId: string;
    coordinator: BotRecord;
    members: BotRecord[];
    operation: GroupTurnOperation;
  }): Promise<void> {
    const run = args.operation.goalRun;
    if (!run) return;
    const skillAuthoringClaim = { claimed: false };
    const room = store.group(args.groupId);
    const pinRoomFolder = () => {
      const task = store.groupTaskByThread(args.groupId, args.threadId);
      return task?.pinnedCwd === undefined && !room?.cwd ? null : store.pinGroupCwd(args.groupId, args.threadId);
    };
    const research = room?.kind === "research" ? prepareResearchRun({
      groupId: args.groupId,
      goalFile: room.goalFile,
      goalFileHash: room.goalFileHash,
      folder: pinRoomFolder() ?? room.cwd ?? undefined,
      runId: run.runId,
      dataDir: DATA_DIR,
      eventsDir: EVENTS_DIR,
      members: args.members,
      memberThreads: (botId) => [args.threadId, ...roomLaneThreads(botId, args.threadId)],
      instanceOf: (botId) => store.bot(botId)?.modelSelection.instanceId,
    }) : undefined;
    if (research && !research.ok) {
      finishGroupGoalRun(args.groupId, args.operation, research.status, research.detail);
      return;
    }
    const wiring = research?.wiring;
    const planSource = latestRoomPlan(store.messagesFor(args.threadId), room?.projectProfile);
    const note = (text: string) => store.appendMessage(args.threadId, { role: "bot", kind: "activity", from: { botId: args.coordinator.id, name: args.coordinator.name, color: args.coordinator.color }, tool: { name: text, ok: false } });
    try {
    const isolated = room ? await goalBranchRuns.prepare(room, args.threadId, run.runId, run.goal, pinRoomFolder()) : {};
    if (args.operation.cancelled) { if (isolated.manager) goalCards.branches(args.threadId, run, isolated.manager.card()); return; }
    if (isolated.notice) note(isolated.notice);
    const manager = isolated.manager;
    const workFolder = () => manager?.state().cwd ?? pinRoomFolder();
    const branchFiles = [...(room?.branchFiles ?? [])];
    const setup = structuredClone(room?.projectProfile?.setup ?? []);
    const prepare = async (cwd: string) => {
      if (manager && branchFiles.length) await manager.copyFiles(cwd, branchFiles);
      for (const command of setup) {
        if (args.operation.cancelled) return;
        const result = await runVerifyCommand(command, cwd, args.operation.cancellation.signal);
        if (!args.operation.cancelled && result.exitCode !== (command.expectExit ?? 0)) throw new GoalBranchWorkflowError(`Worktree setup ${command.id} failed: ${result.output.slice(-300)}`);
      }
    };
    if (manager) {
      goalCards.branches(args.threadId, run, manager.card());
      if (branchFiles.length && isolated.created) await manager.copyFiles(manager.state().cwd, branchFiles);
    }
    const branchWork = manager ? createGoalBranchWorkflow({ manager, run, lead: args.coordinator, roleOf: (id) => roomRoles(room)?.[id], botOf: (id) => store.bot(id) ?? undefined,
      cancelled: () => args.operation.cancelled, prepare,
      execute: (batch) => runGoalWaveOnTree({ groupId: args.groupId, threadId: args.threadId, coordinatorBot: args.coordinator, run, cancelled: () => args.operation.cancelled, batch }),
      note, update: (card) => goalCards.branches(args.threadId, run, card),
    }) : undefined;
    await runGoalRun({
      run,
      branchWork,
      coordinator: args.coordinator,
      members: args.members,
      tasksAllowed: Boolean(room && !room.dm) && goalWavesEnabled({ memberCount: args.members.filter((member) => !member.hidden).length, goalWaves: room?.goalWaves }),
      ...(room && !room.dm && roomRoles(room) ? { roles: roomRoles(room) } : {}),
      cancelled: () => args.operation.cancelled,
      current: (botId) => store.bot(botId) ?? undefined,
      taskThread: (_bot, assignment) => {
        const group = store.group(args.groupId);
        if (!group || group.dm) return undefined;
        const snippet = assignment.replace(/\s+/g, " ").trim().slice(0, 48);
        const task = store.createGroupTask(args.groupId, `${group.name} · ${snippet || "goal task"}`, false);
        return task ? { threadId: task.threadId } : undefined;
      },
      step: (bot, coordinator, instructions, lane) => runGroupGoalStep({ ...args, bot, skillAuthoringClaim, coordinator, instructions: manager ? `${instructions}\nServer Git state: ${JSON.stringify(manager.card())}. Work only in the integration folder as Lead; implementation belongs to Worker tasks.` : instructions, lead: args.coordinator, lane, cwd: manager?.state().cwd }),
      dispatchWave: (batch) => args.operation.goalRun
        ? runGoalWaveOnTree({ groupId: args.groupId, threadId: args.threadId, coordinatorBot: args.coordinator, run: args.operation.goalRun, cancelled: () => args.operation.cancelled, batch })
        : Promise.resolve(batch.map((task) => ({ botId: task.bot.id, ran: false, replyText: "", outcome: "dispatch_failed" as const }))),
      snapshotWrites: async () => {
        const cwd = workFolder() ?? undefined;
        return cwd ? writesSnapshot(cwd) : undefined;
      },
      writesOutside: async (before, declared) => {
        const cwd = workFolder() ?? undefined;
        if (!cwd) return undefined;
        const after = await writesSnapshot(cwd);
        return after ? writesOutside(before, after, declared) : undefined;
      },
      verify: wiring?.verify ?? (room && !room.dm && room.verify?.length ? room.verify : undefined),
      ...(room && !room.dm && room.projectProfile ? {
        projectProfile: room.projectProfile,
        ...(!pinRoomFolder() ? { projectRefusal: "This room has a project profile but no working folder. Set the room's folder, then send the goal again." } : {}),
      } : {}),
      recordBaseline: (baseline) => goalCards.baseline(args.threadId, args.operation.goalRun, baseline),
      ...(wiring ? {
        research: wiring.research,
        missingHandoffFiles: wiring.missingHandoffFiles,
        heldOutTouched: wiring.heldOutTouched,
        readMetric: wiring.readMetric,
        recordMetric: wiring.recordMetric,
      } : {}),
      ...(room && !room.dm && room.verify?.length && !pinRoomFolder()
        ? { verifyRefusal: "This room has completion checks but no working folder to run them in. Set the room's folder, then send the goal again." }
        : {}),
      runVerify: async (command) => {
        const roomCwd = workFolder();
        const result = await (roomCwd ? runVerifyCommand(command, roomCwd, args.operation.cancellation.signal) : { id: command.id, exitCode: null, output: "the room has no working folder" });
        wiring?.recordVerify(result);
        return result;
      },
      ...(room?.kind === "research" ? {
        vendorOf: (botId: string) => {
          const bot = store.bot(botId);
          return bot ? modelVendor(registry.cliTarget(bot.modelSelection.instanceId)?.driverKind, bot.modelSelection.model) : undefined;
        },
      } : {}),
      recordBrief: (brief) => goalCards.brief(args.threadId, args.operation.goalRun, brief),
      ...(planSource ? { planSource } : {}),
      recordPlanSource: (source) => goalCards.planSource(args.threadId, args.operation.goalRun, source),
      laneEdits: async (botId, sinceMs) => {
        const found = await Promise.all(roomLaneThreads(botId, args.threadId).map((threadId) =>
          readFile(join(EVENTS_DIR, `${threadId}.ndjson`), "utf8").then((raw) => editedPaths(raw, sinceMs), () => [])));
        return found.flat();
      },
      steerLane: async (botId, text) => {
        const threadId = roomLaneThreads(botId, args.threadId).find((candidate) => runningTurnEngines.has(candidate));
        const instance = threadId ? runningTurnInstance(store.bot(botId), threadId) : null;
        if (!threadId || !instance?.adapter.capabilities.queueing || !instance.adapter.steer) return false;
        const outcome = await instance.adapter.steer(threadId, text).catch((): SteerOutcome => "indeterminate");
        if (outcome === "refused") return false;
        store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: text, ok: false } });
        return outcome === "steered";
      },
      recordConflict: (conflict) => goalCards.conflict(args.threadId, args.operation.goalRun, conflict),
      finish: (status, detail, text) => {
        wiring?.recordEnd(status, detail);
        finishGroupGoalRun(args.groupId, args.operation, status, detail, text);
      },
      progress: (detail, text) => updateGroupGoalRunProgress(args.operation, detail, text),
      note,
    });
    } catch (error) {
      if (!args.operation.cancelled) finishGroupGoalRun(args.groupId, args.operation, error instanceof GoalBranchWorkflowError ? error.status : "blocked", error instanceof Error ? error.message : "Goal branches could not run");
    }
  }

  return { runGroupGoalOperation, goalBranchRuns };
}
