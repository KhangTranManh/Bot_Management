import type { CSSProperties } from "react";
import type { Bot, Group } from "@/state/store";
import type { MemberNow } from "../../../shared/room-now";
import { latestGoal, officeSeats, officeState, OFFICE_STATE, ROLE_NAME, ROOM_SIZE } from "./office-model";

type Point = [number, number];
const C = .866;
const project = (x: number, y: number, z = 0): Point => [(x - y) * 26 * C, (x + y) * 13 - z * 26];
const points = (rows: Point[]) => rows.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
const textWidth = (text: string, px: number) => text.length * px;
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const ROOM_CENTERS: Point[] = [[-8, -8], [-10, 4], [4, -10], [10, 10]];
const HUB: Point = [0, -30];
const stillMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ROOM_HUE = { research: "#ffd23f", code: "#00e5ff", chat: "#9d7bff" };

function curve(from: Point, to: Point, lift: number, gap = 0) {
  const control: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - lift];
  const trim = ([x, y]: Point, length: number): Point => {
    const size = Math.hypot(control[0] - x, control[1] - y) || 1;
    return [x + (control[0] - x) / size * length, y + (control[1] - y) / size * length];
  };
  const start = trim(from, gap), end = trim(to, gap + 3);
  return `M${start[0].toFixed(1)},${start[1].toFixed(1)} Q${control[0].toFixed(1)},${control[1].toFixed(1)} ${end[0].toFixed(1)},${end[1].toFixed(1)}`;
}

function Desk({ x, y }: { x: number; y: number }) {
  const x0 = x - .85, x1 = x + .85, y0 = y - .55, y1 = y + .55, h = .5;
  return <g>
    <polygon className="office-desk-r" points={points([project(x1, y0, h), project(x1, y1, h), project(x1, y1), project(x1, y0)])} />
    <polygon className="office-desk-l" points={points([project(x0, y1, h), project(x1, y1, h), project(x1, y1), project(x0, y1)])} />
    <polygon className="office-desk-top" points={points([project(x0, y0, h), project(x1, y0, h), project(x1, y1, h), project(x0, y1, h)])} />
    <polygon className="office-screen" points={points([project(x0 + .25, y0 + .2, h), project(x1 - .25, y0 + .2, h), project(x1 - .25, y0 + .2, h + .55), project(x0 + .25, y0 + .2, h + .55)])} />
  </g>;
}

function Pill({ at: [ax, ay], name, role, y }: { at: Point; name: string; role?: string; y: number }) {
  const width = Math.max(textWidth(name, 7.2) + (role ? textWidth(role, 6.4) + 10 : 0) + 18, 54);
  return <>
    <rect className="office-pill" x={ax - width / 2} y={ay + y} width={width} height="18" rx="2" />
    <text x={ax - width / 2 + 9} y={ay + y + 12.5}><tspan className="office-pill-name">{name}</tspan>{role && <tspan className="office-pill-role" dx="6">{role}</tspan>}</text>
  </>;
}

export function OfficeScene({ groups, bots, jobs, selected, select, openRoom }: {
  groups: Group[]; bots: Bot[]; jobs: Record<string, MemberNow[]>; selected?: string;
  select(group: Group, bot: Bot): void; openRoom(group: Group): void;
}) {
  const chief = bots.find((bot) => bot.chiefOfStaff && !bot.hidden);
  const [width, depth] = ROOM_SIZE;
  const extent: Point[] = [[-100, -90], [100, 60]];
  const rooms = groups.slice(0, ROOM_CENTERS.length).map((group, index) => {
    const [cx, cy] = ROOM_CENTERS[index]!;
    const x0 = cx - width / 2, y0 = cy - depth / 2;
    const members = group.memberIds.flatMap((id) => bots.find((bot) => bot.id === id && !bot.hidden) ?? []);
    const roles = group.roles ?? {};
    const seats = officeSeats(members.slice(0, 6), roles).map((seat) => {
      const job = jobs[group.id]?.find((row) => row.botId === seat.bot.id);
      return { ...seat, x: x0 + seat.x, y: y0 + seat.y, job, state: officeState(seat.bot, job), at: project(x0 + seat.x, y0 + seat.y + .75, 1.05) };
    });
    const corners = [project(x0, y0), project(x0 + width, y0), project(x0 + width, y0 + depth), project(x0, y0 + depth)];
    extent.push(...corners, [corners[0]![0] - 110, corners[0]![1] - 70], [corners[0]![0] + 110, corners[0]![1] - 70],
      ...seats.flatMap(({ at }) => [[at[0] - 70, at[1] - 60], [at[0] + 70, at[1] + 20]] as Point[]));
    return { group, members, roles, seats, corners, x0, y0 };
  });
  const xs = extent.map(([x]) => x), ys = extent.map(([, y]) => y);
  const box = [Math.min(...xs) - 24, Math.min(...ys) - 24, Math.max(...xs) - Math.min(...xs) + 48, Math.max(...ys) - Math.min(...ys) + 48];
  const grid = Array.from({ length: 21 }, (_, n) => n * 2 - 20);

  return <svg viewBox={box.join(" ")} className="office-scene" aria-label="Các room xếp quanh Chief of Staff, mỗi bot ngồi một bàn, nối theo cách phối hợp của đội">
    <defs>
      <filter id="office-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
      <filter id="office-bloom" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <linearGradient id="office-beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ff2bd6" /><stop offset="1" stopColor="#00e5ff" /></linearGradient>
      {([["plan", "#00e5ff"], ["check", "#ffd23f"], ["queue", "#4da3ff"]] as const).map(([kind, color]) =>
        <marker key={kind} id={`office-arrow-${kind}`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" fill={color} /></marker>)}
    </defs>
    <g className="office-grid">
      {grid.map((n) => <g key={n} className={n % 10 === 0 ? "is-major" : undefined}>
        <line x1={project(n, -20)[0]} y1={project(n, -20)[1]} x2={project(n, 20)[0]} y2={project(n, 20)[1]} />
        <line x1={project(-20, n)[0]} y1={project(-20, n)[1]} x2={project(20, n)[0]} y2={project(20, n)[1]} />
      </g>)}
    </g>
    {rooms.map(({ group, members, roles, seats, corners, x0, y0 }) => {
      const goal = latestGoal(group);
      const x1 = x0 + width, y1 = y0 + depth;
      const [hx, hy] = corners[0]!;
      const [lx, ly] = project(x0 + .5, y1 - .55);
      const kind = group.kind ?? "chat";
      const meta = goal ? `lượt ${goal.turnCount}/${goal.maxTurns}` : `${members.length} bot`;
      const name = clip(group.name, 26);
      const hudWidth = Math.max(textWidth(name, 8.2), textWidth(`${kind}   ${meta}`, 6.4)) + 22;
      return <g key={group.id} className="office-room" style={{ "--room-hue": ROOM_HUE[kind] } as CSSProperties} data-office-room={group.id}>
        <polygon className="office-plat-side" points={points([project(x1, y0), project(x1, y1), project(x1, y1, -.35), project(x1, y0, -.35)])} />
        <polygon className="office-plat-side" points={points([project(x0, y1), project(x1, y1), project(x1, y1, -.35), project(x0, y1, -.35)])} opacity=".75" />
        <polygon className="office-plat-glow" points={points(corners)} />
        <polygon className="office-platform" points={points(corners)} />
        <text className="office-floor-text" transform={`matrix(${C} .5 -${C} .5 ${lx.toFixed(1)} ${ly.toFixed(1)})`}>{clip(group.name.toUpperCase(), 22)}</text>
        {seats.map(({ bot, x, y }) => <Desk key={bot.id} x={x} y={y} />)}
        <g role="button" tabIndex={0} aria-label={`Mở room ${group.name}`} className="office-room-label" transform={`translate(${hx - hudWidth / 2} ${hy - 62})`}
          onClick={() => openRoom(group)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRoom(group); } }}>
          <path d={`M0 0 H${hudWidth - 8} L${hudWidth} 8 V44 H8 L0 36 Z`} />
          <text className="office-hud-name" x="11" y="19">{name}</text>
          <text x="11" y="35"><tspan className="office-hud-kind">{kind}</tspan><tspan className="office-meta" dx="10">{meta}</tspan></text>
        </g>
        {seats.map(({ bot, job, state, at: [ax, ay] }) => {
          const key = `${group.id}:${bot.id}`;
          const role = ROLE_NAME[roles[bot.id] ?? ""];
          return <g key={key} className="office-bot" data-state={state} role="button" tabIndex={0} aria-pressed={selected === key}
            aria-label={`${bot.name}, ${role ?? "chưa có vai"}, ${OFFICE_STATE[state]}`}
            onClick={() => select(group, bot)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(group, bot); } }}>
            <title>{`${bot.name} · ${bot.modelSelection.model}${job ? ` · ${job.task}` : ""}`}</title>
            <circle className="office-halo" cx={ax} cy={ay} r="16" />
            <circle className="office-core" cx={ax} cy={ay} r="10" />
            <circle className="office-ring" cx={ax} cy={ay} r="15" />
            <text className="office-initial" x={ax} y={ay}>{Array.from(bot.name)[0]}</text>
            <Pill at={[ax, ay]} name={clip(bot.name, 12)} role={role} y={-38} />
            {state !== "idle" && <text className="office-state-word" x={ax} y={ay - 47} textAnchor="middle">{OFFICE_STATE[state]}</text>}
          </g>;
        })}
      </g>;
    })}
    {rooms.map(({ group, roles, seats }) => {
      const lead = seats.find(({ bot }) => roles[bot.id] === "lead");
      const workers = seats.filter(({ stage }) => stage === "work");
      const checks = seats.filter(({ stage }) => stage === "check");
      const working = latestGoal(group)?.status === "working";
      const seatOf = (id: string) => seats.find(({ bot }) => bot.id === id);
      const handoffs = lead && working ? seats.filter((seat) => seat !== lead && seat.job?.state === "running") : [];
      return <g key={group.id} className="office-links" data-office-links={group.id}>
        {lead && <path className="office-link" d={curve(HUB, lead.at, 40, 16)}><title>{`${chief?.name ?? "Chief of Staff"} → Lead ${lead.bot.name}`}</title></path>}
        {lead && workers.map((worker) => <path key={worker.bot.id} className="office-role-link is-plan" markerEnd="url(#office-arrow-plan)" d={curve(lead.at, worker.at, 14, 17)}>
          <title>{`Lead ${lead.bot.name} chia task cho Worker ${worker.bot.name}; task độc lập chạy song song`}</title></path>)}
        {workers.flatMap((worker) => checks.map((check) => <path key={`${worker.bot.id}:${check.bot.id}`} className="office-role-link is-check" markerEnd="url(#office-arrow-check)" d={curve(worker.at, check.at, -14, 17)}>
          <title>{`${ROLE_NAME[roles[check.bot.id]!]} ${check.bot.name} nhận kết quả của ${worker.bot.name}; Tester và Reviewer có thể chạy cùng lúc`}</title></path>))}
        {group.queue?.filter((entry) => entry.waitingForBotId).map((entry) => {
          const from = seatOf(entry.waitingForBotId!), to = seatOf(entry.botId);
          return from && to ? <path key={`${entry.threadId}:${entry.botId}`} className="office-beam is-queued" markerEnd="url(#office-arrow-queue)" d={curve(from.at, to.at, 34, 17)}><title>Hàng chờ thật của room</title></path> : null;
        })}
        {handoffs.map((seat, n) => {
          const d = curve(lead!.at, seat.at, 34, 17);
          const text = clip(seat.job!.task.replace(/\s+/g, " "), 28);
          const bubble = textWidth(text, 5.9) + 16;
          const middle = [(lead!.at[0] + seat.at[0]) / 2, (lead!.at[1] + seat.at[1]) / 2 - 17];
          return <g key={seat.bot.id}>
            <path className="office-beam" d={d}><title>{`Lead ${lead!.bot.name} → ${seat.bot.name}: ${seat.job!.task}`}</title></path>
            <g className="office-bubble" transform={stillMotion() ? `translate(${middle.join(" ")})` : undefined}>
              <rect x={-bubble / 2} y="-21" width={bubble} height="17" rx="2" /><text x="0" y="-9" textAnchor="middle">{text}</text>
              {!stillMotion() && <animateMotion dur="3.6s" begin={`${-n * 1.2}s`} repeatCount="indefinite" path={d} keyPoints=".2;.8" keyTimes="0;1" calcMode="linear" />}
            </g>
          </g>;
        })}
      </g>;
    })}
    <g className="office-hub">
      <ellipse className="office-hub-ring" rx="84" ry="48" opacity=".3" />
      <ellipse className="office-hub-spin" rx="62" ry="36" />
      <ellipse className="office-hub-ring office-pulse" rx="40" ry="23" opacity=".8" />
      <circle className="office-hub-core" cy={HUB[1]} r="14" />
      <text className="office-initial" y={HUB[1]}>{chief ? Array.from(chief.name)[0] : "B"}</text>
      <Pill at={HUB} name={chief?.name ?? "Bot Management"} role={chief ? "Chief of Staff" : undefined} y={-44} />
    </g>
  </svg>;
}
