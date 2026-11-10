import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { Bot, Group } from "@/state/store";
import { TEAM_ROLES, type TeamRole } from "../../../shared/team-roles";
import type { MemberNow } from "../../../shared/room-now";
import { ranFor } from "@/lib/room-now";
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

const ROLE_LABEL: Record<TeamRole, LocaleKey> = {
  lead: "room.panel.role.lead",
  worker: "room.panel.role.worker",
  tester: "room.panel.role.tester",
  reviewer: "room.panel.role.reviewer",
  evaluator: "room.panel.role.evaluator",
};

/** The roles after giving `botId` the role `role`; one lead at most, so a new lead replaces the old one. */
export function withRole(roles: Readonly<Record<string, TeamRole>> | undefined, botId: string, role: TeamRole | ""): Record<string, TeamRole> {
  const next: Record<string, TeamRole> = {};
  for (const [id, current] of Object.entries(roles ?? {})) if (id !== botId && !(role === "lead" && current === "lead")) next[id] = current;
  if (role) next[botId] = role;
  return next;
}

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

/** One row per member: its team role, who is working, waiting on the person, idle or unreachable, and on which model.
 * `onRoles` makes each role a choice. */
export function RoomStatus({ group, members, onRoles, now = [] }: {
  group: Pick<Group, "busyBotId" | "messages" | "roles">;
  members: Bot[];
  onRoles?: (roles: Record<string, TeamRole>) => void;
  /** Each member's job right now; a running one counts as working. */
  now?: readonly MemberNow[];
}) {
  const goal = [...group.messages].reverse().find((message) => message.kind === "goal.run")?.goalRun;
  const liveGoal = goal && goal.status === "working" ? goal : undefined;
  return (
    <Card label={t("room.panel.status")} anchor="status">
      {members.map((member) => {
        const job = now.find((row) => row.botId === member.id);
        const presence = presenceOf(member, group.busyBotId === member.id || job?.state === "running", liveGoal?.coordinatorBotId === member.id);
        return (
          <div key={member.id} data-status-row={member.id} data-presence={presence} className={cn(rowCls, "gap-2.5")}>
            <BotAvatar bot={member} state={presence === "working" ? "working" : "happy"} size={28} animated={false} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink">{member.name}</div>
              <div className="truncate text-[12px] text-ink-tertiary">{member.modelSelection.model}</div>
              {job && (
                <div data-now-row={member.id} data-now-state={job.state} className="mt-0.5 text-[12px] leading-snug">
                  <div dir="auto" className="line-clamp-2 text-ink-secondary">
                    {job.state === "queued" ? `${t("room.panel.now.queued")} · ` : ""}{job.task}
                    {job.since ? <span className="text-ink-tertiary"> · {ranFor(job.since)}</span> : null}
                  </div>
                  {job.step && <div dir="auto" className={cn("truncate", job.stepOk === false ? "text-danger" : "text-ink-tertiary")}>↳ {job.step}</div>}
                </div>
              )}
            </div>
            {onRoles ? (
              <select
                data-role-select={member.id}
                aria-label={t("room.panel.role.aria", { name: member.name })}
                value={group.roles?.[member.id] ?? ""}
                onChange={(event) => onRoles(withRole(group.roles, member.id, event.target.value as TeamRole | ""))}
                className="shrink-0 rounded-md border border-hairline/60 bg-inset px-1.5 py-0.5 text-[12px] text-ink-secondary"
              >
                <option value="">{t("room.panel.role.none")}</option>
                {TEAM_ROLES.map((role) => <option key={role} value={role}>{t(ROLE_LABEL[role])}</option>)}
              </select>
            ) : group.roles?.[member.id] ? (
              <span data-role={group.roles[member.id]} className="shrink-0 rounded-md bg-ink/[0.05] px-1.5 py-0.5 text-[11px] text-ink-secondary">
                {t(ROLE_LABEL[group.roles[member.id]!])}
              </span>
            ) : null}
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
