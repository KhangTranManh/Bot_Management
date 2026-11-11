import type { Group } from "@/state/store";
import type { MemberNow } from "../../../shared/room-now";
import { goalReports } from "./goal-insights";
import { ROLE_NAME } from "./office-model";

const number = (value: number) => value.toLocaleString("vi-VN");

export function GoalInsights({ group, cardId, now }: { group: Group; cardId: string; now: readonly MemberNow[] }) {
  const reports = goalReports(group, cardId);
  const usage = group.usage;
  return <div className="goal-insights">
    <section><h3>Công việc hiện tại</h3>
      {now.length ? <ul>{now.map((job) => <li key={`${job.threadId}:${job.botId}`}><strong>{ROLE_NAME[group.roles?.[job.botId] ?? ""] ?? "Thành viên"}</strong><span>{job.state === "queued" ? "xếp hàng" : "đang xử lý"} · {job.task}</span></li>)}</ul> : <p>Không có công việc đang chạy trong room.</p>}
    </section>
    <section><h3>Kiểm tra</h3>
      {reports.length ? <ul>{reports.slice(-8).map(({ message, role, verdict }) => <li key={message.id}><strong>{ROLE_NAME[role]} · {message.from?.name}{verdict ? ` · ${verdict}` : ""}</strong><p>{message.text!.slice(0, 600)}{message.text!.length > 600 ? "…" : ""}</p></li>)}</ul> : <p>Chưa có báo cáo Tester hoặc Reviewer trong phần lịch sử đã tải. Kết quả nằm ở lane được mở từ hoạt động bên dưới.</p>}
    </section>
    {usage && <section><h3>Lượng dùng của thread đang mở</h3><p>Gồm các lượt đã ghi nhận trong cuộc trò chuyện này; không phải số đo riêng của goal hoặc toàn bộ lane.</p>
      <dl><div><dt>Input</dt><dd>{number(usage.input)}</dd></div><div><dt>Output</dt><dd>{number(usage.output)}</dd></div><div><dt>Cache (đã nằm trong input)</dt><dd>{usage.cachedInput === undefined ? "—" : number(usage.cachedInput)}</dd></div><div><dt>Chi phí ghi nhận</dt><dd>{usage.costUsd === null ? "Chưa có số liệu" : `$${usage.costUsd.toFixed(4)}`}</dd></div></dl>
    </section>}
  </div>;
}
