import { Plus, Trash2 } from "lucide-react";
import type { VerifyCommand } from "../../../shared/wire";

export const MAX_COMMANDS = 8;

export function verifyDraftProblem(checks: readonly VerifyCommand[]): string | undefined {
  if (checks.length > MAX_COMMANDS) return `Tối đa ${MAX_COMMANDS} lệnh.`;
  const ids = new Set<string>();
  for (const check of checks) {
    if (!check.id.trim() || !check.command.trim()) return "Mỗi lệnh cần id và nội dung lệnh.";
    if (ids.has(check.id.trim())) return "Id của các lệnh không được trùng nhau.";
    ids.add(check.id.trim());
    if (check.timeoutSec !== undefined && (!Number.isFinite(check.timeoutSec) || check.timeoutSec <= 0 || check.timeoutSec > 3600)) return "Timeout cần lớn hơn 0 và không quá 3600 giây.";
    if (check.expectExit !== undefined && !Number.isInteger(check.expectExit)) return "Mã thoát mong đợi phải là số nguyên.";
  }
}

export const trimmedCommands = (checks: readonly VerifyCommand[]): VerifyCommand[] =>
  checks.map((check) => ({ ...check, id: check.id.trim(), command: check.command.trim() }));

export function VerifyCommandsEditor({ title, idPrefix, empty, checks, onChange }: {
  title: string;
  idPrefix: string;
  empty: string;
  checks: VerifyCommand[];
  onChange(checks: VerifyCommand[]): void;
}) {
  const name = title.toLowerCase();
  const change = (index: number, patch: Partial<VerifyCommand>) => onChange(checks.map((check, n) => n === index ? { ...check, ...patch } : check));
  const add = () => {
    let n = checks.length + 1;
    while (checks.some((check) => check.id === `${idPrefix}-${n}`)) n++;
    onChange([...checks, { id: `${idPrefix}-${n}`, command: "", timeoutSec: 120, expectExit: 0 }]);
  };
  return <>
    <div className="workflow-check-heading"><span>{title} · {checks.length}/{MAX_COMMANDS} lệnh</span><button type="button" disabled={checks.length >= MAX_COMMANDS} onClick={add}><Plus size={14} />Thêm</button></div>
    {!checks.length && <p>{empty}</p>}
    {checks.map((check, index) => <div key={index} className="workflow-check">
      <div><label>Id<input aria-label={`Id ${name} ${index + 1}`} maxLength={60} value={check.id} onChange={(e) => change(index, { id: e.target.value })} /></label><button type="button" aria-label={`Xoá ${name} ${index + 1}`} onClick={() => onChange(checks.filter((_, n) => n !== index))}><Trash2 size={15} /></button></div>
      <label>Lệnh<textarea aria-label={`Lệnh ${name} ${index + 1}`} maxLength={2000} rows={2} value={check.command} onChange={(e) => change(index, { command: e.target.value })} /></label>
      <label>Thư mục con<input aria-label={`Thư mục ${name} ${index + 1}`} maxLength={200} value={check.cwd ?? ""} placeholder=". (thư mục room)" onChange={(e) => change(index, { cwd: e.target.value || undefined })} /></label>
      <div><label>Timeout (giây)<input type="number" min={1} max={3600} value={check.timeoutSec ?? 600} onChange={(e) => change(index, { timeoutSec: e.target.valueAsNumber })} /></label><label>Mã thoát<input type="number" step={1} value={check.expectExit ?? 0} onChange={(e) => change(index, { expectExit: e.target.valueAsNumber })} /></label></div>
    </div>)}
  </>;
}
