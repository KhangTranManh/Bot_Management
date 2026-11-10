import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { Bot, Group } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { Card, rowCls } from "../bot-panel/rows";

type Presence = "working" | "coordinating" | "waiting" | "idle" | "offline";

const LABEL: Record<Presence, LocaleKey> = {
  working: "room.panel.status.working",
  coordinating: "room.panel.status.coordinating",
  waiting: "room.panel.status.waiting",
  idle: "room.panel.status.idle",
  offline: "room.panel.status.offline",
};

const DOT: Record<Presence, string> = {
  working: "bg-accent animate-pulse",
  coordinating: "bg-accent animate-pulse",
  waiting: "bg-warning",
  idle: "bg-ink-tertiary/50",
  offline: "bg-danger",
};

export function presenceOf(bot: Pick<Bot, "busy" | "activity">, speaking: boolean, leadsGoal = false): Presence {
  if (bot.activity === "dead" || bot.activity === "no-signal") return "offline";
  if (leadsGoal) return "coordinating";
  if (bot.activity === "waiting-on-you") return "waiting";
  if (speaking || bot.busy || bot.activity === "working") return "working";
  return "idle";
}

/** One row per member: who is working, waiting on the person, idle or unreachable, and on which model. */
export function RoomStatus({ group, members }: { group: Pick<Group, "busyBotId" | "messages">; members: Bot[] }) {
  const goal = [...group.messages].reverse().find((message) => message.kind === "goal.run")?.goalRun;
  const liveGoal = goal && goal.status === "working" ? goal : undefined;
  return (
    <Card label={t("room.panel.status")} anchor="status">
      {members.map((member) => {
        const presence = presenceOf(member, group.busyBotId === member.id, liveGoal?.coordinatorBotId === member.id);
        return (
          <div key={member.id} data-status-row={member.id} data-presence={presence} className={cn(rowCls, "gap-2.5")}>
            <BotAvatar bot={member} state={presence === "working" ? "working" : "happy"} size={28} animated={false} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink">{member.name}</div>
              <div className="truncate text-[12px] text-ink-tertiary">{member.modelSelection.model}</div>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-secondary">
              <span aria-hidden="true" className={cn("size-2 rounded-full", DOT[presence])} />
              {presence === "coordinating" && liveGoal
                ? t("room.panel.status.coordinatingTurn", { turn: String(liveGoal.turnCount), max: String(liveGoal.maxTurns) })
                : t(LABEL[presence])}
            </span>
          </div>
        );
      })}
    </Card>
  );
}
