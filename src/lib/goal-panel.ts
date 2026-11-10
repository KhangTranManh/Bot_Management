import { useSyncExternalStore } from "react";

const watchers = new Set<() => void>();
let openCardId: string | null = null;

function publish(next: string | null) {
  if (next === openCardId) return;
  openCardId = next;
  for (const watch of Array.from(watchers)) watch();
}

export const openGoalPanel = (cardId: string): void => publish(cardId);
export const closeGoalPanel = (): void => publish(null);

export function useGoalPanel(): string | null {
  return useSyncExternalStore(
    (watch) => { watchers.add(watch); return () => { watchers.delete(watch); }; },
    () => openCardId,
    () => null,
  );
}
