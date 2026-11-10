import { useEffect, useSyncExternalStore } from "react";

import type { AppState, Group } from "@/state/store";

const watchers = new Set<() => void>();
let openGroupId: string | null = null;
let opener: HTMLElement | null = null;
const dismissedRooms = new Set<string>();

function publish(next: string | null) {
  if (next === openGroupId) return;
  openGroupId = next;
  for (const watch of Array.from(watchers)) watch();
}

export function openRoomPanel(groupId: string, from?: HTMLElement | null): void {
  opener = from ?? null;
  dismissedRooms.delete(groupId);
  publish(groupId);
}

/** `refocus` hands focus back to what opened the panel, for a close the person asked for. */
export function closeRoomPanel({ refocus = false }: { refocus?: boolean } = {}): void {
  if (refocus && openGroupId) dismissedRooms.add(openGroupId);
  const returnTo = opener;
  opener = null;
  publish(null);
  if (refocus && returnTo?.isConnected) returnTo.focus();
}

function subscribe(watch: () => void) {
  watchers.add(watch);
  return () => {
    watchers.delete(watch);
  };
}

export function useRoomPanel(): string | null {
  return useSyncExternalStore(subscribe, () => openGroupId, () => null);
}

/** Whether the shell draws the open room's panel. Another room, another view, a bot panel or a mode change closes it. */
export function useRoomPanelShown({ group, state, simple, autoOpen = false }: {
  group: Pick<Group, "id" | "dm"> | undefined;
  state: Pick<AppState, "selectedId" | "activeView" | "settingsOpen">;
  simple: boolean;
  /** Opens a team room's panel on arrival, until the person closes it there. */
  autoOpen?: boolean;
}): boolean {
  const open = useRoomPanel();
  const arrivalId = autoOpen && simple && state.activeView === "chat" && group && !group.dm && !state.settingsOpen && !dismissedRooms.has(group.id) ? group.id : null;
  useEffect(() => {
    closeRoomPanel();
    if (arrivalId) openRoomPanel(arrivalId);
  }, [state.selectedId, state.activeView, simple, arrivalId]);
  useEffect(() => {
    if (state.settingsOpen) closeRoomPanel();
  }, [state.settingsOpen]);
  return simple && state.activeView === "chat" && group !== undefined && open === group.id;
}

// A remote client cannot open desktop panels, so it keeps every control in the header.
export function simpleRoomHeader({ advanced, remoteClient, group, setupPending }: {
  advanced: boolean;
  remoteClient: boolean;
  group: Pick<Group, "dm">;
  setupPending: boolean;
}): boolean {
  return !advanced && !remoteClient && !group.dm && !setupPending;
}
