import { useState } from "react";
import { api, useStore, type Group } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import type { RoomProjectProfile, VerifyCommand } from "../../../shared/wire";
import { isProjectTemplate, PROJECT_TEMPLATES, type ProjectTemplate } from "../../../shared/project-template";
import { trimmedCommands, verifyDraftProblem, VerifyCommandsEditor } from "./VerifyCommandsEditor";

const TEXT_LIMIT = 4000;
const MAX_PROTECTED = 16;

export interface ProjectDraft {
  template?: ProjectTemplate;
  instructions: string;
  moduleMap: string;
  protectedPaths: string;
  setup: VerifyCommand[];
}

export const projectDraft = (profile: RoomProjectProfile | null | undefined): ProjectDraft => ({
  template: profile?.template,
  instructions: profile?.instructions ?? "",
  moduleMap: profile?.moduleMap ?? "",
  protectedPaths: (profile?.protectedPaths ?? []).join("\n"),
  setup: profile?.setup ?? [],
});

const pathLines = (text: string): string[] => text.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);

export function projectDraftProblem(draft: ProjectDraft): string | undefined {
  if (draft.template !== undefined && !isProjectTemplate(draft.template)) return "Mẫu dự án không hợp lệ.";
  if (draft.instructions.length > TEXT_LIMIT || draft.moduleMap.length > TEXT_LIMIT) return `Chỉ dẫn và sơ đồ module tối đa ${TEXT_LIMIT} ký tự mỗi ô.`;
  const paths = pathLines(draft.protectedPaths);
  if (paths.length > MAX_PROTECTED) return `Tối đa ${MAX_PROTECTED} đường dẫn cần giữ nguyên.`;
  for (const path of paths) {
    if (path.length > 200) return "Mỗi đường dẫn tối đa 200 ký tự.";
    if (/^[/\\]|^[A-Za-z]:/.test(path) || path.split(/[/\\]/).includes("..")) return `"${path}" phải là đường dẫn tương đối trong thư mục room.`;
  }
  return verifyDraftProblem(draft.setup);
}

export function projectProfileOf(draft: ProjectDraft): RoomProjectProfile {
  const paths = pathLines(draft.protectedPaths);
  return {
    ...(draft.template ? { template: draft.template } : {}),
    ...(draft.instructions.trim() ? { instructions: draft.instructions.trim() } : {}),
    ...(draft.moduleMap.trim() ? { moduleMap: draft.moduleMap.trim() } : {}),
    ...(paths.length ? { protectedPaths: paths } : {}),
    ...(draft.setup.length ? { setup: trimmedCommands(draft.setup) } : {}),
  };
}

export function RoomProjectSettings({ group }: { group: Group }) {
  const { dispatch } = useStore();
  const allowed = useOwnerOrAdmin();
  const [draft, setDraft] = useState(() => projectDraft(group.projectProfile));
  const [base, setBase] = useState(() => JSON.stringify(group.projectProfile ?? null));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const current = JSON.stringify(group.projectProfile ?? null);
  const conflict = current !== base;
  const dirty = JSON.stringify(projectProfileOf(draft)) !== JSON.stringify(projectProfileOf(projectDraft(group.projectProfile)));
  const disabled = !allowed || busy || Boolean(group.working);
  const reload = () => { setDraft(projectDraft(group.projectProfile)); setBase(current); setError(""); setNotice(""); };
  const send = async (projectProfile: RoomProjectProfile | null) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const { group: updated } = await api<{ group: Group }>(`/api/groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ projectProfile }) });
      dispatch({ type: "groupPatched", group: updated });
      setDraft(projectDraft(updated.projectProfile));
      setBase(JSON.stringify(updated.projectProfile ?? null));
      setNotice(projectProfile ? "Đã lưu hồ sơ dự án." : "Đã xoá hồ sơ dự án.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được hồ sơ dự án."); }
    finally { setBusy(false); }
  };
  const save = () => {
    const problem = projectDraftProblem(draft);
    if (problem) { setError(problem); return; }
    const profile = { ...projectProfileOf(draft), ...(group.projectProfile?.plan ? { plan: group.projectProfile.plan } : {}) };
    void send(Object.keys(profile).length ? profile : null);
  };
  if (group.dm) return null;
  return <section className="room-workflow-settings" aria-label="Hồ sơ dự án" data-room-project-settings>
    <h3>Hồ sơ dự án</h3>
    <p>Dùng cho goal trên dự án có sẵn. Trước lượt bot đầu tiên, server chạy setup rồi verify để lấy trạng thái gốc; Lead và từng task nhận hồ sơ cùng kết quả đó.</p>
    {!allowed && <p>Chỉ chủ sở hữu hoặc admin có thể sửa phần này.</p>}
    {conflict && <p role="status">Hồ sơ trên server đã đổi. <button type="button" onClick={reload}>Tải lại</button> trước khi sửa tiếp.</p>}
    <fieldset disabled={disabled || conflict}>
      <label>Mẫu dự án<select aria-label="Mẫu dự án" value={draft.template ?? ""} onChange={(e) => setDraft({ ...draft, template: isProjectTemplate(e.target.value) ? e.target.value : undefined })}>
        <option value="">Không chọn mẫu</option>
        {PROJECT_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
      </select><span>Gợi ý cấu trúc và cách kiểm theo loại dự án. Bạn vẫn cần cấu hình lệnh verify cho dự án.</span></label>
      <label>Chỉ dẫn dự án<textarea aria-label="Chỉ dẫn dự án" rows={4} maxLength={TEXT_LIMIT} value={draft.instructions} placeholder="Quy ước code, lệnh build, file hướng dẫn trong repo (AGENTS.md, CONTRIBUTING.md)…" onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} /><span>{draft.instructions.length}/{TEXT_LIMIT}</span></label>
      <label>Sơ đồ module<textarea aria-label="Sơ đồ module" rows={4} maxLength={TEXT_LIMIT} value={draft.moduleMap} placeholder="server/ — API; src/ — giao diện; shared/ — kiểu dữ liệu chung…" onChange={(e) => setDraft({ ...draft, moduleMap: e.target.value })} /><span>{draft.moduleMap.length}/{TEXT_LIMIT}</span></label>
      <label>Đường dẫn cần giữ nguyên (mỗi dòng một đường dẫn)<textarea aria-label="Đường dẫn cần giữ nguyên" rows={2} value={draft.protectedPaths} placeholder="migrations/" onChange={(e) => setDraft({ ...draft, protectedPaths: e.target.value })} /><span>Chỉ là lời dặn cho bot, không phải sandbox: file vẫn có thể bị sửa.</span></label>
      <VerifyCommandsEditor title="Setup" idPrefix="setup" empty="Chưa có lệnh setup. Setup lỗi thì goal dừng trước khi bot nào làm việc." checks={draft.setup} onChange={(setup) => setDraft({ ...draft, setup })} />
      <div className="workflow-actions">
        <button type="button" disabled={!dirty} onClick={save}>{busy ? "Đang lưu…" : "Lưu hồ sơ"}</button>
        {group.projectProfile && <button type="button" onClick={() => void send(null)}>Xoá hồ sơ</button>}
      </div>
    </fieldset>
    {group.working && <p>Đợi goal hiện tại kết thúc trước khi sửa hồ sơ.</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
