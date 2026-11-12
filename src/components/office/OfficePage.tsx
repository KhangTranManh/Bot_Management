import { useMemo, useState, type ReactNode } from "react";
import { Menu, Plus, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { api, useStore, openRoomThread, type Group, type Bot, type Message } from "@/state/store";
import { ranFor } from "@/lib/room-now";
import { NewRoomPanel } from "../SidebarNewRoomPanel";
import { OfficeScene } from "./OfficeScene";
import { useOfficeNow } from "./use-office-now";
import { latestGoal, officeNeeds, officeRooms, officeState, OFFICE_STATE, ROLE_NAME } from "./office-model";

function Hud({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return <section className="office-hud"><h2><span>{title}</span>{count !== undefined && <span>{count}</span>}</h2>{children}</section>;
}

export function OfficePage({ onMenu }: { onMenu(): void }) {
  const { state, dispatch } = useStore();
  const groups = useMemo(() => officeRooms(state.groups), [state.groups]);
  const { jobs, failed, hidden } = useOfficeNow(groups);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<{ groupId: string; botId: string }>();
  const [create, setCreate] = useState(false);
  const needs = officeNeeds(groups);
  const [accepting, setAccepting] = useState<string>();
  const [acceptError, setAcceptError] = useState("");
  const acceptGoal = async (groupId: string, threadId: string, messageId: string, key: string) => {
    setAccepting(key); setAcceptError("");
    try {
      const reply = await api<{ goalRun: NonNullable<Message["goalRun"]> }>(`/api/groups/${groupId}/tasks/${threadId}/goals/${messageId}/accept`, { method: "POST" });
      const message = state.groups.find((group) => group.id === groupId)?.messages.find((candidate) => candidate.id === messageId);
      if (message) dispatch({ type: "messagePatched", threadId, message: { ...message, goalRun: reply.goalRun } });
    } catch (cause) { setAcceptError(cause instanceof Error ? cause.message : "Không xác nhận được goal."); }
    finally { setAccepting(undefined); }
  };
  const visible = groups.filter((group) => filter === "all" || (filter === "need" ? needs.some((item) => item.group.id === group.id) : group.kind === filter));
  const pages = Math.max(1, Math.ceil(visible.length / 4));
  const currentPage = Math.min(page, pages - 1);
  const shown = visible.slice(currentPage * 4, currentPage * 4 + 4);
  const chosenRoom = groups.find((group) => group.id === selected?.groupId);
  const chosenBot = state.bots.find((bot) => bot.id === selected?.botId && !bot.hidden);
  const chosenJob = chosenRoom && jobs[chosenRoom.id]?.find((row) => row.botId === chosenBot?.id);
  const goals = visible.flatMap((group) => {
    const goal = latestGoal(group);
    return goal ? [{ group, goal }] : [];
  });
  const events = groups.flatMap((group) => group.messages.filter((message) => message.kind === "activity" && message.tool)
    .map((message) => ({ group, message }))).sort((a, b) => b.message.at - a.message.at).slice(0, 5);
  const openRoom = (group: Group, threadId?: string, messageId?: string) => {
    openRoomThread(dispatch, { groupId: group.id, threadId }, state.groups);
    if (messageId) dispatch({ type: "focusMessage", threadId: threadId ?? group.threadId, messageId });
  };
  const choose = (group: Group, bot: Bot) => setSelected({ groupId: group.id, botId: bot.id });
  return <main className="office-page" data-office-page data-hidden={hidden}>
    <div className="office-shell">
      <header className="office-header">
        <button type="button" aria-label="Mở menu" className="office-icon office-mobile-menu" onClick={onMenu}><Menu size={18} /></button>
        <div><h1>Văn phòng</h1><p className="office-system"><span>SYS://{state.connected ? "online" : "offline"}</span> · {groups.length} room · {new Set(groups.flatMap((group) => group.memberIds)).size} bot · {groups.filter((group) => latestGoal(group)?.status === "working").length} goal đang chạy</p></div>
        <button type="button" className="office-action" onClick={() => setCreate(true)}><Plus size={15} />Tạo room</button>
      </header>
      {!state.connected && <p role="status" className="office-warning">Mất kết nối. Dữ liệu đang hiển thị là bản gần nhất.</p>}
      {failed > 0 && <p role="status" className="office-warning">Chưa cập nhật được trạng thái của {failed}/{groups.length} room. Đang thử lại.</p>}
      <div className="office-filters" role="group" aria-label="Lọc room">
        {[["all", "Tất cả"], ["code", "Code"], ["research", "Research"], ["need", "Cần bạn"]].map(([id, name]) =>
          <button type="button" key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(0); }}>{name}{id === "need" && <span>{needs.length}</span>}</button>)}
      </div>
      {groups.length === 0 ? <Hud title="Chưa có room nào"><p>Tạo room để xem các thành viên và công việc của đội ở đây.</p><button className="office-action" onClick={() => setCreate(true)}>Tạo room</button></Hud> : <div className="office-layout">
        <div className="office-stage-column">
          <section className="office-stage" aria-label="Sơ đồ văn phòng">
            <div className="office-stage-label">LIVE://room · {shown.length}/{visible.length}</div>
            {shown.length ? <OfficeScene groups={shown} bots={state.bots} jobs={jobs} selected={selected ? `${selected.groupId}:${selected.botId}` : undefined} select={choose} openRoom={openRoom} /> : <p className="office-empty">Không có room phù hợp.</p>}
            <div className="office-legend">
              {Object.entries(OFFICE_STATE).map(([id, label]) => <span key={id} data-state={id} className="office-state">{label}</span>)}
            </div>
          </section>
          <div className="office-pagination"><span>{visible.length ? currentPage + 1 : 0}/{visible.length ? pages : 0} trang</span><button className="office-icon" aria-label="Trang trước" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><button className="office-icon" aria-label="Trang sau" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div>
          <div className="office-room-list">{visible.map((group) => <Hud key={group.id} title={group.name} count={group.memberIds.length}>
            <button className="office-action" onClick={() => openRoom(group)}>Mở room<ArrowUpRight size={14} /></button>
            {group.memberIds.flatMap((id) => {
              const bot = state.bots.find((candidate) => candidate.id === id && !candidate.hidden);
              if (!bot) return [];
              const job = jobs[group.id]?.find((row) => row.botId === id);
              return <button key={id} className="office-member" onClick={() => choose(group, bot)}><span>{bot.name}<small>{ROLE_NAME[group.roles?.[id] ?? ""] ?? bot.modelSelection.model}</small></span><span className="office-state" data-state={officeState(bot, job)}>{OFFICE_STATE[officeState(bot, job)]}</span></button>;
            })}
          </Hud>)}</div>
          <p className="office-footnote">Sàn mỗi room chia theo vai: Lead, Workers, Kiểm tra, từ trái sang phải. Khi một bot nhận việc, tờ phiếu bay từ người giao sang bàn của nó rồi nằm lại đó tới khi xong; màn hình bàn sáng khi bot đang chạy. Chồng phiếu mờ là việc đang xếp hàng. Nét mặt của bot đổi theo việc nó đang làm; lúc rảnh không có gì chuyển động.</p>
        </div>
        <div className="office-rail">
          <Hud title="Luồng công việc" count={goals.length}>
            {!goals.length && <p>Chưa có goal trong các room đang hiển thị.</p>}
            {goals.map(({ group, goal }) => <button key={goal.runId} className="office-goal" onClick={() => openRoom(group, group.threadId, group.messages.find((m) => m.goalRun?.runId === goal.runId)?.id)}>
              <span><b>{group.name}</b><small>lượt {goal.turnCount}/{goal.maxTurns}</small></span><strong>{goal.goal}</strong>
              <div className="office-progress"><i style={{ width: `${Math.min(100, goal.turnCount / Math.max(1, goal.maxTurns) * 100)}%` }} /></div>
              <small>{goal.status} · tiến độ lượt</small>
            </button>)}
          </Hud>
          <Hud title="Cần bạn" count={needs.length}>
            {!needs.length && <p>Không có yêu cầu đang chờ trong lịch sử đã tải.</p>}
            {needs.map((item) => <div key={`${item.group.id}:${item.id}`} className="office-need"><b>{item.title}</b><small>{item.group.name} · {item.detail}</small><button className="office-action office-wait-action" onClick={() => openRoom(item.group, item.group.threadId, item.group.messages.some((m) => m.id === item.id) ? item.id : undefined)}>Mở</button>{item.accept && <button className="office-action office-wait-action" disabled={accepting === item.id} onClick={() => void acceptGoal(item.group.id, item.accept!.threadId, item.accept!.messageId, item.id)}>Xác nhận xong</button>}</div>)}{acceptError && <p role="alert">{acceptError}</p>}
          </Hud>
          <Hud title="Bot đang chọn">
            {chosenRoom && chosenBot ? <div className="office-detail"><h3>{chosenBot.name}</h3><p>{ROLE_NAME[chosenRoom.roles?.[chosenBot.id] ?? ""] ?? "Chưa có vai"} · {chosenRoom.name}</p><code>{chosenBot.modelSelection.model}</code>
              <span className="office-state" data-state={officeState(chosenBot, chosenJob)}>{OFFICE_STATE[officeState(chosenBot, chosenJob)]}</span>
              {chosenJob && <><p>{chosenJob.task}</p>{chosenJob.since && <small>{ranFor(chosenJob.since)}</small>}{chosenJob.step && <code>{chosenJob.step}</code>}</>}
              {!chosenJob && chosenBot.busy && <p>Bot đang xử lý ở luồng khác.</p>}
              <button className="office-action" onClick={() => openRoom(chosenRoom, chosenJob?.threadId)}>Mở {chosenJob ? "lane" : "room"}<ArrowUpRight size={14} /></button>
            </div> : <p>Chọn một bot trong sơ đồ hoặc danh sách để xem công việc và mở lane.</p>}
          </Hud>
          <Hud title="Vừa xảy ra" count={events.length}>
            {!events.length && <p>Chưa có hoạt động trong lịch sử đã tải.</p>}
            <ol className="office-events">{events.map(({ group, message }) => <li key={message.id}><time>{new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><button onClick={() => openRoom(group, group.threadId, message.id)}><b>{group.name}</b><span>{(message.tool?.label ?? message.tool?.name ?? "").slice(0, 160)}</span></button></li>)}</ol>
          </Hud>
        </div>
      </div>}
    </div>
    {create && <NewRoomPanel onClose={() => setCreate(false)} />}
  </main>;
}
