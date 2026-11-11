import { useState } from "react";
import { api, useStore, type Message } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import type { GoalBranchCard } from "../../shared/goal-branches";

export function GoalBranchControls({ message, groupId, threadId }: { message: Message; groupId: string; threadId: string }) {
  const { dispatch } = useStore();
  const allowed = useOwnerOrAdmin();
  const [pending, setPending] = useState<{ action: "merge" | "discard"; head: string; context: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = message.goalRun;
  const branches = run?.branches;
  if (!branches || !run) return null;
  const context = `${message.id}:${branches.runId}`;
  const labels = { pending: "Branch đang được giữ", kept: "Đã giữ branch", merged: "Đã merge vào branch gốc", discarded: "Đã bỏ branch" };
  const resolved = branches.decision === "merged" || branches.decision === "discarded";
  const send = async (action: "merge" | "keep" | "discard", head = branches.head, reviewed = context) => {
    if (busy) return;
    if (head !== branches.head || reviewed !== context) { setPending(null); setError("Branch đã đổi. Kiểm tra lại rồi xác nhận lại."); return; }
    setBusy(true); setError("");
    try {
      const reply = await api<{ branches: GoalBranchCard }>(`/api/groups/${groupId}/tasks/${threadId}/goals/${message.id}/branches`, { method: "POST", body: JSON.stringify({ action, head, ...(action !== "keep" ? { confirm: true } : {}) }) });
      dispatch({ type: "messagePatched", threadId, message: { ...message, goalRun: { ...run, branches: reply.branches } } });
      setPending(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được branch."); }
    finally { setBusy(false); }
  };
  const button = "rounded-lg border border-hairline/50 px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-raised disabled:opacity-50";
  return <section aria-label="Branch của goal" data-goal-branches className="mt-3 min-w-0 rounded-xl bg-inset p-3" onClick={(event) => event.stopPropagation()}>
    <p className="text-[12px] font-medium text-ink-secondary" aria-live="polite">{labels[branches.decision]}</p>
    <code className="mt-1 block break-all text-[11px] text-ink-secondary">{branches.branch}</code>
    <p className="mt-1 text-[12px] text-ink-tertiary">{branches.tasks.filter((task) => task.phase === "merged").length} task đã ghép · {branches.tasks.filter((task) => task.phase === "conflict").length} conflict</p>
    {!resolved && allowed && run.status !== "working" && <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy || run.status !== "completed"} onClick={() => { setPending({ action: "merge", head: branches.head, context }); setError(""); }}>Merge vào branch gốc</button>
      <button type="button" className={button} disabled={busy || branches.decision === "kept"} onClick={() => void send("keep")}>Giữ branch</button>
      <button type="button" className={button} disabled={busy} onClick={() => { setPending({ action: "discard", head: branches.head, context }); setError(""); }}>Bỏ branch</button>
    </div>}
    <details className="mt-2 text-[12px] text-ink-secondary"><summary>Task và kết quả merge</summary><ul className="mt-2 space-y-2">{branches.tasks.map((task) => <li key={task.key} className="break-words"><span>{task.taskId} · {task.phase}</span>{task.changed.length > 0 && <p>{task.changed.slice(0, 8).join(", ")}{task.changed.length > 8 ? "…" : ""}</p>}{task.outsideWrites.length > 0 && <p className="text-danger">Ngoài writes: {task.outsideWrites.slice(0, 8).join(", ")}</p>}{task.conflicts.length > 0 && task.phase === "conflict" && <p className="text-danger">Conflict: {task.conflicts.slice(0, 8).join(", ")}</p>}</li>)}</ul></details>
    {pending && !resolved && allowed && run.status !== "working" && <div role="alertdialog" aria-label={pending.action === "merge" ? "Xác nhận merge goal" : "Xác nhận bỏ branch"} className="mt-3 rounded-lg border border-hairline/50 p-3" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); setPending(null); } }}>
      <p className="text-[12px] text-ink-secondary">{pending.action === "merge" ? `Merge kết quả đã kiểm vào ${branches.originalBranch ?? "branch gốc"}? Server sẽ từ chối nếu HEAD hoặc file của bạn đã đổi.` : "Xoá các branch và worktree của goal này, kể cả file chưa commit trong đó? Thư mục dự án gốc được giữ nguyên."}</p>
      <div className="mt-2 flex gap-2"><button type="button" className={button} autoFocus disabled={busy} onClick={() => setPending(null)}>Huỷ</button><button type="button" className={button} disabled={busy} onClick={() => void send(pending.action, pending.head, pending.context)}>{busy ? "Đang xử lý…" : pending.action === "merge" ? "Xác nhận merge" : "Xác nhận bỏ"}</button></div>
    </div>}
    {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
  </section>;
}
