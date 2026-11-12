import type { Bot, Group, Message } from "@/state/store";
import type { MemberNow } from "../../../shared/room-now";

export type OfficeState = "running" | "queued" | "waiting" | "out" | "idle";
export const OFFICE_STATE: Record<OfficeState, string> = {
  running: "đang xử lý", queued: "xếp hàng", waiting: "chờ bạn", out: "hết lượt", idle: "rảnh",
};
export const ROLE_NAME: Record<string, string> = {
  lead: "Lead", worker: "Worker", tester: "Tester", reviewer: "Reviewer", evaluator: "Evaluator",
};
export type OfficeStage = "lead" | "work" | "check";
const STAGE: Record<string, OfficeStage> = { lead: "lead", worker: "work", tester: "check", reviewer: "check", evaluator: "check" };
export const STAGE_X: Record<OfficeStage, number> = { lead: 1.5, work: 5, check: 8.5 };
export const ROOM_SIZE = [10, 8] as const;
export const officeStage = (role?: string) => role ? STAGE[role] : undefined;

export function officeSeats<T extends { id: string }>(members: readonly T[], roles: Readonly<Record<string, string>> = {}): { bot: T; x: number; y: number; stage?: OfficeStage }[] {
  const [width, depth] = ROOM_SIZE;
  if (!members.some((bot) => officeStage(roles[bot.id]))) {
    const cols = members.length > 4 ? 3 : 2;
    const rows = Math.max(1, Math.ceil(members.length / cols));
    return members.map((bot, n) => ({ bot, x: (n % cols + .5) * width / cols, y: (Math.floor(n / cols) + .5) * depth / rows }));
  }
  const column = (stage: OfficeStage) => members.filter((bot) => (officeStage(roles[bot.id]) ?? "lead") === stage)
    .sort((a, b) => Number(roles[a.id] !== "lead") - Number(roles[b.id] !== "lead"));
  return (["lead", "work", "check"] as const).flatMap((stage) => column(stage).map((bot, n, all) =>
    ({ bot, stage, x: STAGE_X[stage], y: (n + .5) * depth / all.length })));
}
function latestGoalMessage(group: Pick<Group, "messages">) {
  return [...group.messages].reverse().find((message) => message.goalRun);
}
export function latestGoal(group: Pick<Group, "messages">) {
  return latestGoalMessage(group)?.goalRun;
}
export function pendingCards(messages: readonly Message[]) {
  return messages.filter((message) => message.kind === "options" && message.card &&
    !message.card.answered && !message.card.answeredText && !message.card.dismissed && !message.card.expired && !message.card.stopped);
}
export function officeState(bot: Bot, job?: MemberNow): OfficeState {
  if (bot.activity === "waiting-on-you") return "waiting";
  if (job?.state === "queued") return "queued";
  if (job?.state === "running") return "running";
  const latest = [...bot.messages].reverse().find((message) => message.kind === "activity" && message.tool);
  if (!bot.busy && latest?.tool?.limitResetsAt && latest.tool.limitResetsAt > Date.now()) return "out";
  return "idle";
}
export function officeNeeds(groups: readonly Group[]) {
  return groups.flatMap((group) => {
    const cards = pendingCards(group.messages).map((message) => ({ id: message.id, group, title: message.card!.title, detail: message.card!.subtitle, accept: undefined as { threadId: string; messageId: string } | undefined }));
    const goalMessage = latestGoalMessage(group);
    const goal = goalMessage?.goalRun;
    if (goal && ["needs-input", "limit-reached", "paused"].includes(goal.status)) {
      cards.push({ id: goal.runId, group, title: goal.status === "limit-reached" ? "Goal hết lượt" : "Goal cần bạn", detail: goal.detail ?? goal.goal, accept: { threadId: group.threadId, messageId: goalMessage!.id } });
    }
    return cards;
  });
}
export function officeRooms(groups: readonly Group[]) {
  return groups.filter((group) => !group.dm);
}
