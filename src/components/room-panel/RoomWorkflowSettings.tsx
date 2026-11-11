import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, useStore, type Group } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import type { VerifyCommand } from "../../../shared/wire";

export function verifyDraftProblem(checks: readonly VerifyCommand[]): string | undefined {
  if (checks.length > 8) return "Tối đa 8 lệnh verify.";
  const ids = new Set<string>();
  for (const check of checks) {
    if (!check.id.trim() || !check.command.trim()) return "Mỗi lệnh cần id và nội dung lệnh.";
    if (ids.has(check.id.trim())) return "Id của các lệnh không được trùng nhau.";
    ids.add(check.id.trim());
    if (check.timeoutSec !== undefined && (!Number.isFinite(check.timeoutSec) || check.timeoutSec <= 0 || check.timeoutSec > 3600)) return "Timeout cần lớn hơn 0 và không quá 3600 giây.";
    if (check.expectExit !== undefined && !Number.isInteger(check.expectExit)) return "Mã thoát mong đợi phải là số nguyên.";
  }
}

export function RoomWorkflowSettings({ group }: { group: Group }) {
  const { dispatch } = useStore();
  const allowed = useOwnerOrAdmin();
  const [kind, setKind] = useState(group.kind ?? "chat");
  const [goalFile, setGoalFile] = useState(group.goalFile ?? "");
  const [checks, setChecks] = useState<VerifyCommand[]>(group.verify ?? []);
  const [base, setBase] = useState(JSON.stringify([group.kind ?? "chat", group.goalFile ?? "", group.verify ?? []]));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const current = JSON.stringify([group.kind ?? "chat", group.goalFile ?? "", group.verify ?? []]);
  const dirty = JSON.stringify([kind, goalFile, checks]) !== base;
  const conflict = current !== base;
  const disabled = !allowed || busy || Boolean(group.working);
  const reload = () => { setKind(group.kind ?? "chat"); setGoalFile(group.goalFile ?? ""); setChecks(group.verify ?? []); setBase(current); setError(""); setNotice(""); };
  const patch = async (value: Record<string, unknown>) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const { group: updated } = await api<{ group: Group }>(`/api/groups/${group.id}`, { method: "PATCH", body: JSON.stringify(value) });
      dispatch({ type: "groupPatched", group: updated });
      setKind(updated.kind ?? "chat"); setGoalFile(updated.goalFile ?? ""); setChecks(updated.verify ?? []);
      setBase(JSON.stringify([updated.kind ?? "chat", updated.goalFile ?? "", updated.verify ?? []]));
      setNotice(value.researchGoalApprove ? "Server đã duyệt và khoá hash file goal." : "Đã lưu cài đặt room.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được cài đặt."); }
    finally { setBusy(false); }
  };
  const save = () => {
    const problem = kind === "research" ? (!goalFile.trim() ? "Nhập đường dẫn file goal." : undefined) : verifyDraftProblem(checks);
    if (problem) { setError(problem); return; }
    void patch({ kind: kind === "chat" ? null : kind, ...(kind === "research" ? { goalFile: goalFile.trim() } : { verify: checks.map((check) => ({ ...check, id: check.id.trim(), command: check.command.trim() })) }) });
  };
  const changeCheck = (index: number, patch: Partial<VerifyCommand>) => setChecks((before) => before.map((check, n) => n === index ? { ...check, ...patch } : check));
  if (group.dm) return null;
  return <section className="room-workflow-settings" aria-label="Cài đặt workflow">
    <h3>Cài đặt room</h3>
    {!allowed && <p>Chỉ chủ sở hữu hoặc admin có thể sửa phần này.</p>}
    {conflict && <p role="status">Cài đặt trên server đã đổi. <button type="button" onClick={reload}>Tải lại</button> trước khi sửa tiếp.</p>}
    <fieldset disabled={disabled || conflict}>
      <label>Loại room<select aria-label="Loại room" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="chat">Chat</option><option value="code">Code</option><option value="research">Research</option></select></label>
      {kind === "research" ? <>
        <label>File goal<input aria-label="File goal" maxLength={200} value={goalFile} placeholder="research.goal.json" onChange={(e) => setGoalFile(e.target.value)} /></label>
        <p>Đường dẫn tương đối trong thư mục room. Server kiểm tra schema và nội dung file khi duyệt và trước mỗi run.</p>
        {group.goalFileHash ? <p>Hash của lần duyệt: <code>{group.goalFileHash}</code></p> : <p>Chưa có hash được duyệt.</p>}
        <button type="button" className="workflow-approve" disabled={dirty || !group.goalFile} onClick={() => void patch({ researchGoalApprove: true })}>Duyệt file goal</button>
        {dirty && <p>Lưu cài đặt trước khi duyệt file goal.</p>}
      </> : <>
        <div className="workflow-check-heading"><span>Verify · {checks.length}/8 lệnh</span><button type="button" disabled={checks.length >= 8} onClick={() => {
          let n = checks.length + 1;
          while (checks.some((check) => check.id === `check-${n}`)) n++;
          setChecks([...checks, { id: `check-${n}`, command: "", timeoutSec: 120, expectExit: 0 }]);
        }}><Plus size={14} />Thêm</button></div>
        {!checks.length && <p>Chưa có lệnh kiểm tra do server chạy. Chỉ chạy khi bạn gửi goal.</p>}
        {checks.map((check, index) => <div key={index} className="workflow-check">
          <div><label>Id<input aria-label={`Id verify ${index + 1}`} maxLength={60} value={check.id} onChange={(e) => changeCheck(index, { id: e.target.value })} /></label><button type="button" aria-label={`Xoá verify ${index + 1}`} onClick={() => setChecks(checks.filter((_, n) => n !== index))}><Trash2 size={15} /></button></div>
          <label>Lệnh<textarea aria-label={`Lệnh verify ${index + 1}`} maxLength={2000} rows={2} value={check.command} onChange={(e) => changeCheck(index, { command: e.target.value })} /></label>
          <label>Thư mục con<input aria-label={`Thư mục verify ${index + 1}`} maxLength={200} value={check.cwd ?? ""} placeholder=". (thư mục room)" onChange={(e) => changeCheck(index, { cwd: e.target.value || undefined })} /></label>
          <div><label>Timeout (giây)<input type="number" min={1} max={3600} value={check.timeoutSec ?? 600} onChange={(e) => changeCheck(index, { timeoutSec: e.target.valueAsNumber })} /></label><label>Mã thoát<input type="number" step={1} value={check.expectExit ?? 0} onChange={(e) => changeCheck(index, { expectExit: e.target.valueAsNumber })} /></label></div>
        </div>)}
      </>}
      <button type="button" disabled={!dirty} onClick={save}>{busy ? "Đang lưu…" : "Lưu cài đặt"}</button>
    </fieldset>
    {group.working && <p>Đợi goal hiện tại kết thúc trước khi sửa cài đặt.</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
