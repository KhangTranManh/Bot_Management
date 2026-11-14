import { useState } from "react";
import { api, useStore, type Group, type Message } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import type { RoomPlanCard as RoomPlanData } from "../../shared/room-plan";

const STATUS: Record<RoomPlanData["status"], string> = {
  working: "Đang phác thảo",
  ready: "Bản phác thảo",
  failed: "Không phác thảo được",
  stopped: "Đã dừng",
};

/** The outline a Lead drafted for `/plan`; saving it keeps it for goals started after the chat grows long. */
export function RoomPlanCard({ message, group }: { message: Message; group: Group }) {
  const plan = message.roomPlan;
  const { dispatch } = useStore();
  const allowed = useOwnerOrAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!plan) return null;
  const draft = plan.draft;
  const saved = Boolean(draft && JSON.stringify(group.projectProfile?.plan) === JSON.stringify(draft));
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const { group: updated } = await api<{ group: Group }>(`/api/groups/${group.id}`, {
        method: "PATCH", body: JSON.stringify({ projectProfile: { ...group.projectProfile, plan: draft } }),
      });
      dispatch({ type: "groupPatched", group: updated });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được bản phác thảo."); }
    finally { setBusy(false); }
  };
  return (
    <section data-room-plan-card aria-label={STATUS[plan.status]} className="w-full max-w-[680px] rounded-2xl border border-hairline/45 bg-card px-3.5 py-3 text-[13px] text-ink shadow-sm">
      <h3 className="text-[14px] font-semibold">{draft?.brief.goal ?? STATUS[plan.status]}</h3>
      <p className="mt-0.5 text-[12px] text-ink-tertiary">{STATUS[plan.status]} · {plan.coordinatorName}</p>
      {plan.detail && <p className="mt-1 text-ink-secondary">{plan.detail}</p>}
      {draft && <>
        <h4 className="mt-2 font-medium">Cấu trúc</h4>
        <ul className="list-disc pl-5">
          {(draft.brief.structure ?? []).map((area) => <li key={area.name}><b>{area.name}</b>{area.readOnly ? " (chỉ đọc)" : ""} — {area.owns} <code>{area.paths.join(", ")}</code></li>)}
        </ul>
        <h4 className="mt-2 font-medium">Thứ tự wave</h4>
        <ol className="list-decimal pl-5">
          {draft.waves.map((wave) => <li key={wave.name}><b>{wave.name}</b> [{wave.areas.join(", ")}] — {wave.deliverable}</li>)}
        </ol>
        {draft.brief.openQuestions.length > 0 && <>
          <h4 className="mt-2 font-medium">Câu hỏi còn mở</h4>
          <ul className="list-disc pl-5">{draft.brief.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
        </>}
        <div className="mt-2 flex items-center gap-2">
          <button type="button" disabled={!allowed || busy || saved} onClick={() => void save()} className="rounded-lg border border-hairline/50 px-2.5 py-1 text-[12px] font-medium hover:bg-raised">
            {saved ? "Đã lưu vào hồ sơ dự án" : busy ? "Đang lưu…" : "Lưu vào hồ sơ dự án"}
          </button>
          {error && <span role="alert" className="text-danger">{error}</span>}
        </div>
      </>}
    </section>
  );
}
