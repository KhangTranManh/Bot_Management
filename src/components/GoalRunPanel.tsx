import { useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Bot, type Group, type Message } from "@/state/store";
import { roundButtonCls } from "./bot-panel/rows";
import { RoomStatus } from "./room-panel/RoomStatus";

const FEED_LIMIT = 30;
const LINE_LIMIT = 160;
const OUTPUT_LIMIT = 700;

function line(text: string | undefined, limit = LINE_LIMIT): string {
  const clean = text?.replace(/\s+/g, " ").trim() ?? "";
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

function feedOf(messages: Message[], cardId: string): Message[] {
  const start = messages.findIndex((message) => message.id === cardId);
  return messages.slice(start + 1)
    .filter((message) => message.role === "bot" && (message.kind === "text" || message.kind === "activity") && line(message.kind === "activity" ? message.tool?.label ?? message.tool?.name : message.text))
    .slice(-FEED_LIMIT)
    .reverse();
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The live view of one goal run: where it stands, who is doing what, and what the team did since it started. */
export function GoalRunPanel({ group, cardId, onClose }: { group: Group; cardId: string; onClose(): void }) {
  const { state } = useStore();
  const ref = useRef<HTMLElement>(null);
  const card = group.messages.find((message) => message.id === cardId);
  const run = card?.goalRun;
  const members = useMemo(
    () => group.memberIds.map((id) => state.bots.find((bot) => bot.id === id)).filter((bot): bot is Bot => Boolean(bot)),
    [group.memberIds, state.bots],
  );
  const feed = useMemo(() => feedOf(group.messages, cardId), [group.messages, cardId]);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!run) return null;
  const nameOf = (message: Message) => message.from?.name ?? "";
  return (
    <aside
      ref={ref}
      role="dialog"
      aria-labelledby="goal-run-panel-title"
      tabIndex={-1}
      data-goal-run-panel
      className="animate-panel-in absolute inset-y-0 right-0 z-50 flex w-full min-w-0 flex-col border-l border-hairline/40 bg-panel shadow-2xl outline-none md:w-[min(420px,42vw)]"
    >
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 px-4">
        <span className="text-[13px] font-medium text-ink-secondary">
          {t("routines.goal.turnOf", { turn: Math.min(run.turnCount + 1, run.maxTurns), max: run.maxTurns })}
        </span>
        <button type="button" onClick={onClose} aria-label={t("botSettings.simple.close")} className={roundButtonCls}>
          <X size={16} className="pointer-events-none" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-7">
        <h2 id="goal-run-panel-title" dir="auto" className="text-[16px] font-semibold text-ink">{line(run.goal) || t("routines.goal.groupGoal")}</h2>
        {run.detail && <p dir="auto" className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{line(run.detail)}</p>}
        <RoomStatus group={group} members={members} />
        <h3 className="mt-5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("goal.panel.activity")}</h3>
        {feed.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-tertiary">{t("goal.panel.empty")}</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-2">
            {feed.map((message) => (
              <li key={message.id} data-goal-feed-row className="rounded-xl bg-inset px-3 py-2">
                <div className="flex items-baseline justify-between gap-2 text-[12px] text-ink-tertiary">
                  <span className="truncate font-medium text-ink-secondary">{nameOf(message)}</span>
                  <span className="shrink-0">{clock(message.at)}</span>
                </div>
                <p dir="auto" className={cn("mt-0.5 text-[13px] leading-snug", message.kind === "activity" && message.tool?.ok === false ? "text-danger" : "text-ink")}>
                  {line(message.kind === "activity" ? message.tool?.label ?? message.tool?.name : message.text)}
                </p>
                {message.kind === "activity" && message.tool?.output && (
                  <p dir="auto" data-goal-feed-output className="mt-1 whitespace-pre-line text-[12.5px] leading-snug text-ink-secondary">
                    {line(message.tool.output, OUTPUT_LIMIT)}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
