import type { ServerText } from "../../shared/server-text.ts";
import { fittedLine } from "../routine-lines.ts";
// The goal run card: one receipt per run in the conversation it runs in, a room's or a one-on-one chat's.
import type { GoalBaseline, GoalBrief, GoalConflict, GroupGoalRunCardData, GroupGoalRunStatus } from "../../shared/group-goal-run.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import { GROUP_GOAL_MAX_TURNS } from "../group-goal-run.ts";
import { buildNotification, type Notification } from "../notify.ts";
import type { RoutineManager, RoutineRun } from "../routines.ts";
import type { BotRecord, Message, Store } from "../store.ts";
import type { GoalBranchCard } from "../../shared/goal-branches.ts";
import { conversationLanguage, serverLine, type ServerLineKey } from "../server-lines.ts";

export interface LiveGoalRun {
  runId: string;
  cardMessageId: string;
  goal: string;
  coordinatorBotId: string;
  coordinatorName: string;
  turnCount: number;
  maxTurns: number;
  startedAt: number;
  finished: boolean;
  brief?: GoalBrief;
  baseline?: GoalBaseline;
  branches?: GoalBranchCard;
  conflicts?: GoalConflict[];
}

const CARD_CONFLICTS_MAX = 20;

export interface GoalCardDeps {
  store: Pick<Store, "appendMessage" | "bot" | "messagesFor" | "patchMessage">;
  routines(): Pick<RoutineManager, "finishGoalRun"> | null;
  notify(notification: Notification | null): void;
  routineSourceOwner(run: RoutineRun): { bot: BotRecord } | null;
  routineSourceThread(run: RoutineRun): string | null;
}

const safeBrief = (brief: GoalBrief): GoalBrief => {
  const clean = (entries: readonly string[]) => entries.map((entry) => redactSecretsInText(entry));
  return { goal: redactSecretsInText(brief.goal), inScope: clean(brief.inScope), outOfScope: clean(brief.outOfScope), acceptance: clean(brief.acceptance), constraints: clean(brief.constraints), openQuestions: clean(brief.openQuestions) };
};

function detailFields(detail: string, text?: ServerText) {
  const { text: safe, codes } = fittedLine("attention", detail, text);
  return { detail: safe, detailCode: codes.attentionCode, detailParams: codes.attentionParams };
}

/** A goal card's text for clients that show no cards, by how the goal stands. */
const GOAL_STATE: Record<GroupGoalRunStatus, ServerLineKey> = {
  working: "server.teammates.goal.working",
  completed: "server.teammates.goal.completed",
  "needs-input": "server.teammates.goal.needsInput",
  blocked: "server.teammates.goal.blocked",
  "limit-reached": "server.teammates.goal.limitReached",
  paused: "server.teammates.goal.paused",
  stopped: "server.teammates.goal.stopped",
  failed: "server.teammates.goal.failed",
};

export function createGoalCards(deps: GoalCardDeps) {
  const { store } = deps;

  function start(threadId: string, coordinator: Pick<BotRecord, "id" | "name" | "color">, goal: string, runId: string): LiveGoalRun {
    const startedAt = Date.now(), language = conversationLanguage(threadId);
    const detail = serverLine(language, "server.teammates.goalCoordinating", { bot: coordinator.name });
    const card = store.appendMessage(threadId, {
      role: "bot",
      kind: "goal.run",
      text: serverLine(language, "server.teammates.goal.working", { detail }),
      from: { botId: coordinator.id, name: coordinator.name, color: coordinator.color },
      goalRun: {
        runId,
        goal,
        status: "working",
        coordinatorBotId: coordinator.id,
        coordinatorName: coordinator.name,
        turnCount: 0,
        maxTurns: GROUP_GOAL_MAX_TURNS,
        detail,
        startedAt,
      },
    });
    return {
      runId,
      cardMessageId: card.id,
      goal,
      coordinatorBotId: coordinator.id,
      coordinatorName: coordinator.name,
      turnCount: 0,
      maxTurns: GROUP_GOAL_MAX_TURNS,
      startedAt,
      finished: false,
    };
  }

  /** `stillHere` is false once the conversation is gone: the routine still settles, the card is not touched. */
  function finish(
    threadId: string,
    run: LiveGoalRun | undefined,
    status: Exclude<GroupGoalRunStatus, "working">,
    detail: string,
    stillHere: () => boolean,
    text?: ServerText,
  ): void {
    if (!run || run.finished) return;
    run.finished = true;
    const finishedAt = Date.now();
    const safeDetail = redactSecretsInText(detail.trim()).slice(0, 500);
    const card: GroupGoalRunCardData = {
      runId: run.runId,
      goal: redactSecretsInText(run.goal),
      status,
      coordinatorBotId: run.coordinatorBotId,
      coordinatorName: redactSecretsInText(run.coordinatorName),
      turnCount: run.turnCount,
      maxTurns: run.maxTurns,
      ...detailFields(safeDetail, text),
      startedAt: run.startedAt,
      finishedAt,
      ...(run.brief ? { brief: safeBrief(run.brief) } : {}),
      ...(run.baseline ? { baseline: run.baseline } : {}),
      ...(run.branches ? { branches: run.branches } : {}),
      ...(run.conflicts?.length ? { conflicts: run.conflicts } : {}),
    };
    const routineRun = deps.routines()?.finishGoalRun(run.runId, status, safeDetail);
    // A scheduled team goal that stops to ask must never be filed as a quiet completion.
    if (routineRun?.status === "waiting") {
      const coordinator = store.bot(routineRun.botId);
      if (coordinator) {
        const notificationBot = deps.routineSourceOwner(routineRun)?.bot ?? coordinator;
        deps.notify(buildNotification(
          "question",
          notificationBot,
          deps.routineSourceThread(routineRun) ?? routineRun.threadId ?? threadId,
          safeDetail || `${routineRun.routineName} needs your input`,
          { avatarUrl: notificationBot.avatarUrl },
        ));
      }
    }
    if (routineRun?.status === "completed") {
      const coordinator = store.bot(routineRun.botId);
      if (coordinator) {
        const notificationBot = deps.routineSourceOwner(routineRun)?.bot ?? coordinator;
        deps.notify(buildNotification(
          "done",
          notificationBot,
          deps.routineSourceThread(routineRun) ?? routineRun.threadId ?? threadId,
          safeDetail || routineRun.routineName,
          { avatarUrl: notificationBot.avatarUrl },
        ));
      }
    }
    if (!stillHere()) return;
    store.patchMessage(threadId, run.cardMessageId, {
      text: serverLine(conversationLanguage(threadId), GOAL_STATE[status] ?? "server.teammates.goal.failed", { detail: card.detail || card.goal }),
      goalRun: card,
    });
  }

  function progress(threadId: string, run: LiveGoalRun | undefined, detail: string, text?: ServerText): void {
    if (!run || run.finished) return;
    const safeDetail = redactSecretsInText(detail.trim()).slice(0, 500);
    const current = store.messagesFor(threadId).find((message: Message) => message.id === run.cardMessageId);
    const fields = detailFields(safeDetail, text);
    if (current?.goalRun?.status === "working" && current.goalRun.detail === safeDetail && current.goalRun.detailCode === fields.detailCode
      && JSON.stringify(current.goalRun.detailParams) === JSON.stringify(fields.detailParams)) return;
    store.patchMessage(threadId, run.cardMessageId, {
      text: serverLine(conversationLanguage(threadId), "server.teammates.goal.working", { detail: safeDetail || redactSecretsInText(run.goal) }),
      goalRun: {
        runId: run.runId,
        goal: redactSecretsInText(run.goal),
        status: "working",
        coordinatorBotId: run.coordinatorBotId,
        coordinatorName: redactSecretsInText(run.coordinatorName),
        turnCount: run.turnCount,
        maxTurns: run.maxTurns,
        ...fields,
        startedAt: run.startedAt,
        ...(run.brief ? { brief: safeBrief(run.brief) } : {}),
        ...(run.baseline ? { baseline: run.baseline } : {}),
        ...(run.branches ? { branches: run.branches } : {}),
        ...(run.conflicts?.length ? { conflicts: run.conflicts } : {}),
      },
    });
  }

  function brief(threadId: string, run: LiveGoalRun | undefined, value: GoalBrief): void {
    if (!run || run.finished) return;
    run.brief = value;
    const current = store.messagesFor(threadId).find((message: Message) => message.id === run.cardMessageId)?.goalRun;
    if (current) store.patchMessage(threadId, run.cardMessageId, { goalRun: { ...current, brief: safeBrief(value) } });
  }

  function conflict(threadId: string, run: LiveGoalRun | undefined, value: GoalConflict): void {
    if (!run || run.finished) return;
    run.conflicts = [...(run.conflicts ?? []), value].slice(-CARD_CONFLICTS_MAX);
    const current = store.messagesFor(threadId).find((message: Message) => message.id === run.cardMessageId)?.goalRun;
    if (current) store.patchMessage(threadId, run.cardMessageId, { goalRun: { ...current, conflicts: run.conflicts } });
  }

  function baseline(threadId: string, run: LiveGoalRun | undefined, value: GoalBaseline): void {
    if (!run || run.finished) return;
    const clean = (checks: GoalBaseline["checks"]) => checks.map((check) => ({ ...check, id: redactSecretsInText(check.id), output: redactSecretsInText(check.output).slice(-1_000) }));
    run.baseline = { ...value, setup: clean(value.setup), checks: clean(value.checks) };
    const current = store.messagesFor(threadId).find((message: Message) => message.id === run.cardMessageId)?.goalRun;
    if (current) store.patchMessage(threadId, run.cardMessageId, { goalRun: { ...current, baseline: run.baseline } });
  }

  function branches(threadId: string, run: LiveGoalRun | undefined, value: GoalBranchCard): void {
    if (!run) return;
    const clean = (entries: string[]) => entries.map(redactSecretsInText);
    run.branches = { ...value, originalBranch: value.originalBranch ? redactSecretsInText(value.originalBranch) : null, tasks: value.tasks.map((task) => ({ ...task, taskId: redactSecretsInText(task.taskId), changed: clean(task.changed), outsideWrites: clean(task.outsideWrites), conflicts: clean(task.conflicts) })) };
    const current = store.messagesFor(threadId).find((message: Message) => message.id === run.cardMessageId)?.goalRun;
    if (current) store.patchMessage(threadId, run.cardMessageId, { goalRun: { ...current, branches: run.branches } });
  }

  return { start, finish, progress, brief, conflict, baseline, branches };
}

export type GoalCards = ReturnType<typeof createGoalCards>;
