import { useEffect, useState } from "react";
import { api } from "@/state/api";
import type { Group } from "@/state/store";
import type { MemberNow } from "../../../shared/room-now";

export function useOfficeNow(groups: readonly Group[]) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const changed = () => setHidden(document.hidden);
    changed();
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  const key = groups.map((group) => `${group.id}:${group.threadId}`).sort().join("|");
  const [snapshot, setSnapshot] = useState<{ key: string; jobs: Record<string, MemberNow[]>; failed: number }>({ key: "", jobs: {}, failed: 0 });
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const targets = key.split("|").filter(Boolean).map((part) => part.split(":"));
    const read = async () => {
      if (document.hidden) { timer = setTimeout(() => void read(), 5000); return; }
      const jobs: Record<string, MemberNow[]> = {};
      let failed = 0;
      for (let i = 0; i < targets.length && !stopped; i += 6) {
        const batch = targets.slice(i, i + 6);
        const results = await Promise.allSettled(batch.map(([id, thread]) =>
          api<{ members: MemberNow[] }>(`/api/groups/${id}/now?threadId=${encodeURIComponent(thread)}`, { background: true, signal: abort.signal, timeoutMs: 8000 })));
        results.forEach((result, index) => {
          if (result.status === "fulfilled") jobs[batch[index][0]] = result.value.members;
          else failed++;
        });
      }
      if (!stopped) { setSnapshot({ key, jobs, failed }); timer = setTimeout(() => void read(), 5000); }
    };
    void read();
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
  }, [key]);
  return { ...(snapshot.key === key ? snapshot : { key, jobs: {}, failed: 0 }), hidden };
}
