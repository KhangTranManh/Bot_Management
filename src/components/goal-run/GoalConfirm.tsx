import { useState } from "react";

import { t } from "@/lib/i18n";
import { api, useStore, type Group, type Message } from "@/state/store";

const WAITING_ON_PERSON = new Set(["needs-input", "limit-reached", "paused"]);

export function goalAwaitsConfirmation(message: Message | undefined): boolean {
  return Boolean(message?.goalRun && WAITING_ON_PERSON.has(message.goalRun.status));
}

/** A goal that stopped for the person is marked completed by the owner or an admin, never by a bot. */
export function GoalConfirm({ group, message }: { group: Group; message: Message }) {
  const { dispatch } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!goalAwaitsConfirmation(message)) return null;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const reply = await api<{ goalRun: NonNullable<Message["goalRun"]> }>(`/api/groups/${group.id}/tasks/${group.threadId}/goals/${message.id}/accept`, { method: "POST" });
      dispatch({ type: "messagePatched", threadId: group.threadId, message: { ...message, goalRun: reply.goalRun } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("goal.confirm.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-goal-confirm className="mt-4">
      <button type="button" disabled={busy} onClick={() => void confirm()} className="ui-button ui-button-primary">
        {t("goal.confirm.button")}
      </button>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
