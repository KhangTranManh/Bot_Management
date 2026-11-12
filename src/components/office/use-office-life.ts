import { useEffect, useRef, useState } from "react";
import type { MemberNow } from "../../../shared/room-now";
import { HOLD_MS } from "./office-emotion";

/** What the office remembers about one bot between two polls of its room's work. */
export interface BotLife {
  running: boolean;
  receivedAt?: number;
  finishedAt?: number;
  step?: string;
  stepChangedAt?: number;
  idleSince?: number;
}
/** Keyed `${groupId}:${botId}`. */
export type OfficeLife = Record<string, BotLife>;

const same = (a: BotLife | undefined, b: BotLife) => a !== undefined && a.running === b.running && a.receivedAt === b.receivedAt &&
  a.finishedAt === b.finishedAt && a.step === b.step && a.stepChangedAt === b.stepChangedAt && a.idleSince === b.idleSince;

/** Folds one poll into the remembered life. A bot already running on the first poll has not just received anything.
 * Returns `previous` itself when nothing changed, so a poll that shows the same thing re-renders nothing. */
export function foldLife(previous: OfficeLife, jobs: Record<string, readonly MemberNow[]>, members: Record<string, readonly string[]>,
  now: number, first: boolean): OfficeLife {
  const next: OfficeLife = {};
  let changed = false;
  for (const [groupId, botIds] of Object.entries(members)) {
    for (const botId of botIds) {
      const key = `${groupId}:${botId}`;
      const job = jobs[groupId]?.find((row) => row.botId === botId);
      const before = previous[key];
      const running = job?.state === "running";
      const life: BotLife = { running };
      if (running) {
        const step = job.step ?? "";
        life.step = step;
        life.stepChangedAt = before?.running && before.step === step ? before.stepChangedAt ?? now : now;
        const received = before?.running ? before.receivedAt : first ? undefined : now;
        if (received !== undefined) life.receivedAt = received;
      } else {
        life.idleSince = before && !before.running ? before.idleSince ?? now : now;
        if (before?.running) life.finishedAt = now;
        else if (before?.finishedAt !== undefined) life.finishedAt = before.finishedAt;
      }
      if (!same(before, life)) changed = true;
      next[key] = life;
    }
  }
  if (Object.keys(previous).length !== Object.keys(next).length) changed = true;
  return changed ? next : previous;
}

/** The office's own memory of who just got work, who just handed it in, who has stood still. */
export function useOfficeLife(jobs: Record<string, readonly MemberNow[]>, members: Record<string, readonly string[]>): OfficeLife {
  const [life, setLife] = useState<OfficeLife>({});
  const polled = useRef(false);
  const shape = JSON.stringify(members);
  useEffect(() => {
    setLife((previous) => foldLife(previous, jobs, JSON.parse(shape) as Record<string, string[]>, Date.now(), !polled.current));
    if (Object.keys(jobs).length > 0) polled.current = true;
  }, [jobs, shape]);
  return life;
}

/** `Date.now()` that moves once a second, so the windows in `officeEmotion` can end. */
export function useOfficeClock(everyMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** `value`, but a new value is shown only after the old one has been on for `holdMs`. */
export function useHeld<T>(value: T, holdMs = HOLD_MS): T {
  const [held, setHeld] = useState(value);
  const shownAt = useRef(Date.now());
  useEffect(() => {
    if (value === held) return;
    const timer = setTimeout(() => {
      shownAt.current = Date.now();
      setHeld(value);
    }, Math.max(0, shownAt.current + holdMs - Date.now()));
    return () => clearTimeout(timer);
  }, [value, held, holdMs]);
  return held;
}
