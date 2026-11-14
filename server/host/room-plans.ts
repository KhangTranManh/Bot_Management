import type { RoomPlanCard, RoomPlanDraft } from "../../shared/room-plan.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import { parseGroupGoalDecision } from "../group-goal-run.ts";
import { parseRoomPlanReply, roomPlanInstructions, safeRoomPlan } from "../room-plan.ts";
import type { BotRecord, Store } from "../store.ts";
import type { createGoalTurns } from "./goal-turns.ts";
import type { GroupMemberBotWaitResult, GroupTurnOperation, GroupTurnOrchestration } from "./group-turn-types.ts";

const PLAN_ATTEMPTS = 2;

export interface RoomPlanDeps {
  store: Pick<Store, "appendMessage" | "patchMessage">;
  goalTurns: ReturnType<typeof createGoalTurns>;
  waitForGroupMemberBot(bot: BotRecord, operation: GroupTurnOperation, onWaiting: (detail: string) => void): Promise<GroupMemberBotWaitResult>;
  runGroupMemberTurn(
    groupId: string, threadId: string, botId: string, hop: number, spoken: Set<string>, cardContinuation: undefined,
    onDispatchError: undefined, isCancelled: () => boolean, onProviderHandshakeStarted: () => void,
    onProviderHandshakeSettled: () => void, skillAuthoringClaim: { claimed: boolean }, orchestration: GroupTurnOrchestration,
  ): Promise<boolean>;
  groupProviderHandshakeStarted(operation: GroupTurnOperation): void;
  groupProviderHandshakeSettled(operation: GroupTurnOperation): void;
  projectContext(groupId: string): string | undefined;
}

/** `/plan`: the Lead writes a checked outline of the project, never tasks, and the card keeps it for later goals. */
export function createRoomPlans(deps: RoomPlanDeps) {
  const { store, goalTurns } = deps;

  async function run(args: {
    groupId: string;
    threadId: string;
    lead: BotRecord;
    members: BotRecord[];
    request: string;
    previous?: RoomPlanDraft;
    operation: GroupTurnOperation;
  }): Promise<void> {
    const { lead, operation, threadId } = args;
    const base = {
      request: redactSecretsInText(args.request), coordinatorBotId: lead.id, coordinatorName: lead.name, startedAt: Date.now(),
    };
    const card = store.appendMessage(threadId, {
      role: "bot", kind: "room.plan", text: "Drafting a project outline.",
      from: { botId: lead.id, name: lead.name, color: lead.color },
      roomPlan: { id: "", ...base, status: "working" },
    });
    const settle = (status: RoomPlanCard["status"], text: string, extra: Pick<RoomPlanCard, "detail" | "draft"> = {}): void => {
      store.patchMessage(threadId, card.id, {
        text,
        roomPlan: { id: card.id, ...base, status, finishedAt: Date.now(), ...extra },
      });
    };
    const roster = args.members.filter((member) => !member.hidden)
      .map((member) => `${member.name} (${member.id})${member.title ? ` — ${member.title}` : ""}`).join("; ");
    const claim = { claimed: false };
    let problem: string | undefined;
    for (let attempt = 0; attempt < PLAN_ATTEMPTS; attempt += 1) {
      if (operation.cancelled) return settle("stopped", "Outline stopped.");
      const availability = await deps.waitForGroupMemberBot(lead, operation, () => undefined);
      if (availability === "cancelled") return settle("stopped", "Outline stopped.");
      if (availability !== "ready") {
        const detail = `${lead.name} is not available to draft the outline.`;
        return settle("failed", detail, { detail });
      }
      const result: GroupTurnOrchestration["result"] = {};
      const turn = goalTurns.begin(threadId);
      try {
        await deps.runGroupMemberTurn(
          args.groupId, threadId, lead.id, 0, new Set(), undefined, undefined, () => operation.cancelled,
          () => deps.groupProviderHandshakeStarted(operation), () => deps.groupProviderHandshakeSettled(operation), claim,
          {
            systemInstructions: roomPlanInstructions({
              request: args.request, roster, projectContext: deps.projectContext(args.groupId), previous: args.previous, problem,
            }),
            followMentions: false,
            result,
            onClaimed: () => { operation.botIds.add(lead.id); },
            onTurnStarted: (turnId) => { if (!turn.turnId) turn.turnId = turnId; },
          },
        );
      } finally {
        operation.botIds.delete(lead.id);
        goalTurns.end(threadId, turn, result.outcome);
      }
      if (operation.cancelled) return settle("stopped", "Outline stopped.");
      if (result.outcome && result.outcome !== "settled") {
        const detail = result.stopReason ?? `${lead.name} could not draft the outline.`;
        return settle("failed", detail, { detail });
      }
      const reply = result.replyText ?? "";
      const parsed = parseRoomPlanReply(reply);
      if ("draft" in parsed) {
        const draft = safeRoomPlan(parsed.draft);
        const summary = parseGroupGoalDecision(reply).visibleText.trim();
        return settle("ready", summary || `Outline ready: ${draft.brief.goal}`, { draft });
      }
      problem = parsed.problem;
    }
    const detail = `${lead.name} did not produce a valid outline: ${problem}`;
    settle("failed", detail, { detail });
  }

  return { run };
}
