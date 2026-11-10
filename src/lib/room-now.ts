import { useEffect, useState } from "react";

import { api } from "@/state/api";
import type { MemberNow } from "../../shared/room-now";

export const ROOM_NOW_POLL_MS = 3_000;

/** What each member of the room is doing now, read every few seconds while `watching`; empty otherwise. */
export function useRoomNow(groupId: string, threadId: string, watching: boolean): MemberNow[] {
  const [rows, setRows] = useState<MemberNow[]>([]);
  useEffect(() => {
    if (!watching) {
      setRows([]);
      return;
    }
    let stopped = false;
    const read = () => {
      void api<{ members: MemberNow[] }>(`/api/groups/${groupId}/now?threadId=${encodeURIComponent(threadId)}`)
        .then((body) => { if (!stopped) setRows(body.members); })
        .catch(() => {});
    };
    read();
    const timer = setInterval(read, ROOM_NOW_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [groupId, threadId, watching]);
  return rows;
}

/** "12 s", "4 min", "1 h 5 min" since `since`. */
export function ranFor(since: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
