import type { CSSProperties } from "react";
import type { MausState } from "@/lib/mascot";
import type { Bot, Group } from "@/state/store";
import { BotAvatar } from "../Avatar";
import type { MemberNow } from "../../../shared/room-now";
import { OfficeBadge } from "./OfficeBadge";
import { CELEBRATE_MS, officeEmotion } from "./office-emotion";
import { latestGoal, officeSeats, officeState, OFFICE_STATE, ROLE_NAME, ROOM_SIZE, type OfficeState } from "./office-model";
import { useHeld, useOfficeClock, useOfficeLife, type BotLife } from "./use-office-life";

type Point = [number, number];
const C = .866;
const project = (x: number, y: number, z = 0): Point => [(x - y) * 26 * C, (x + y) * 13 - z * 26];
const points = (rows: Point[]) => rows.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
const textWidth = (text: string, px: number) => text.length * px;
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const clamp = (value: number) => Math.max(-1, Math.min(1, value));
const ROOM_CENTERS: Point[] = [[-8, -8], [-10, 4], [4, -10], [10, 10]];
const HUB: Point = [0, -30];
const stillMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ROOM_HUE = { research: "#ffd23f", code: "#00e5ff", chat: "#9d7bff" };
/** A hand-off ticket stays in the air this long. */
const HOP_MS = 1_200;
const MASCOT = 44;
const ZONES = [{ from: 0, to: 3.3, name: "LEAD" }, { from: 3.3, to: 6.7, name: "WORKERS" }, { from: 6.7, to: 10, name: "KIỂM TRA" }] as const;

function Desk({ x, y, on }: { x: number; y: number; on: boolean }) {
  const x0 = x - .85, x1 = x + .85, y0 = y - .55, y1 = y + .55, h = .5;
  return <g>
    <polygon className="office-desk-r" points={points([project(x1, y0, h), project(x1, y1, h), project(x1, y1), project(x1, y0)])} />
    <polygon className="office-desk-l" points={points([project(x0, y1, h), project(x1, y1, h), project(x1, y1), project(x0, y1)])} />
    <polygon className="office-desk-top" points={points([project(x0, y0, h), project(x1, y0, h), project(x1, y1, h), project(x0, y1, h)])} />
    <polygon className={on ? "office-screen is-on" : "office-screen"} points={points([project(x0 + .25, y0 + .2, h), project(x1 - .25, y0 + .2, h), project(x1 - .25, y0 + .2, h + .55), project(x0 + .25, y0 + .2, h + .55)])} />
  </g>;
}

/** One name plate: "Tên" and, when it says something new, the role. */
function Pill({ at: [ax, ay], name, role, y }: { at: Point; name: string; role?: string; y: number }) {
  const shownRole = role && role.toLowerCase() !== name.toLowerCase() ? role : undefined;
  const width = Math.max(textWidth(name, 7.2) + (shownRole ? textWidth(shownRole, 6.4) + 10 : 0) + 18, 54);
  return <>
    <rect className="office-pill" x={ax - width / 2} y={ay + y} width={width} height="18" rx="2" />
    <text x={ax - width / 2 + 9} y={ay + y + 12.5}><tspan className="office-pill-name">{name}</tspan>{shownRole && <tspan className="office-pill-role" dx="6">{shownRole}</tspan>}</text>
  </>;
}

/** A paper job ticket lying on a desk. */
function Paper({ at: [x, y], queued = false, title }: { at: Point; queued?: boolean; title?: string }) {
  return <g className={queued ? "office-ticket is-queued" : "office-ticket"} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(-8)`}>
    {title && <title>{title}</title>}
    <rect x="-9" y="-6" width="18" height="12" rx="1.5" />
    <path d="M-5 -2H5M-5 1.5H2" />
  </g>;
}

/** A ticket that flies from the one who hands the work on to the one who takes it, once. */
function Hop({ from, to, text }: { from: Point; to: Point; text: string }) {
  const style = { "--fx": from[0], "--fy": from[1], "--tx": to[0], "--ty": to[1], "--mx": (from[0] + to[0]) / 2, "--my": (from[1] + to[1]) / 2 - 26 } as CSSProperties;
  return <g className="office-ticket-hop" style={style} data-office-hop>
    <rect x="-9" y="-6" width="18" height="12" rx="1.5" className="office-ticket-paper" />
    <path d="M-5 -2H5M-5 1.5H2" className="office-ticket-lines" />
    <text className="office-ticket-text" y="-11" textAnchor="middle">{clip(text.replace(/\s+/g, " "), 22)}</text>
  </g>;
}

function Figure({ bot, at, emotion, gaze }: { bot: Bot; at: Point; emotion: MausState; gaze?: { x: number; y: number } }) {
  const held = useHeld(emotion);
  return <>
    <foreignObject x={at[0] - MASCOT / 2} y={at[1] - MASCOT / 2} width={MASCOT} height={MASCOT} className="office-figure" data-emotion={held}>
      <div className="office-figure-box" style={{ width: MASCOT, height: MASCOT }}>
        <BotAvatar bot={bot} size={MASCOT} state={held} animated={!stillMotion()} {...(gaze ? { gaze } : {})} label="" />
      </div>
    </foreignObject>
    <OfficeBadge face={held} at={at} />
  </>;
}

export function OfficeScene({ groups, bots, jobs, selected, select, openRoom }: {
  groups: Group[]; bots: Bot[]; jobs: Record<string, MemberNow[]>; selected?: string;
  select(group: Group, bot: Bot): void; openRoom(group: Group): void;
}) {
  const shown = groups.slice(0, ROOM_CENTERS.length);
  const life = useOfficeLife(jobs, Object.fromEntries(shown.map((group) => [group.id, group.memberIds])));
  const now = useOfficeClock();
  const chief = bots.find((bot) => bot.chiefOfStaff && !bot.hidden);
  const [width, depth] = ROOM_SIZE;
  const extent: Point[] = [[-100, -90], [100, 60]];
  const rooms = shown.map((group, index) => {
    const [cx, cy] = ROOM_CENTERS[index]!;
    const x0 = cx - width / 2, y0 = cy - depth / 2;
    const members = group.memberIds.flatMap((id) => bots.find((bot) => bot.id === id && !bot.hidden) ?? []);
    const roles = group.roles ?? {};
    const seats = officeSeats(members.slice(0, 6), roles).map((seat) => {
      const job = jobs[group.id]?.find((row) => row.botId === seat.bot.id);
      return { ...seat, x: x0 + seat.x, y: y0 + seat.y, job, state: officeState(seat.bot, job), at: project(x0 + seat.x, y0 + seat.y + .75, 1.05), desk: project(x0 + seat.x, y0 + seat.y, .52) };
    });
    const corners = [project(x0, y0), project(x0 + width, y0), project(x0 + width, y0 + depth), project(x0, y0 + depth)];
    extent.push(...corners, [corners[0]![0] - 110, corners[0]![1] - 70], [corners[0]![0] + 110, corners[0]![1] - 70],
      ...seats.flatMap(({ at }) => [[at[0] - 70, at[1] - 70], [at[0] + 70, at[1] + 20]] as Point[]));
    return { group, members, roles, seats, corners, x0, y0 };
  });
  const xs = extent.map(([x]) => x), ys = extent.map(([, y]) => y);
  const box = [Math.min(...xs) - 24, Math.min(...ys) - 24, Math.max(...xs) - Math.min(...xs) + 48, Math.max(...ys) - Math.min(...ys) + 48];
  const grid = Array.from({ length: 21 }, (_, n) => n * 2 - 20);
  const faceOf = (lifeOf: BotLife | undefined, state: OfficeState, bot: Bot, job: MemberNow | undefined, celebrating: boolean) => officeEmotion({
    state: state === "idle" && bot.busy ? "running" : state, job, celebrating,
    sinceReceived: lifeOf?.receivedAt !== undefined ? now - lifeOf.receivedAt : undefined,
    sinceFinished: lifeOf?.finishedAt !== undefined && !lifeOf.running ? now - lifeOf.finishedAt : undefined,
    stepIdleMs: lifeOf?.running && lifeOf.stepChangedAt !== undefined ? now - lifeOf.stepChangedAt : undefined,
    idleMs: lifeOf && !lifeOf.running && lifeOf.idleSince !== undefined ? now - lifeOf.idleSince : undefined,
  });

  return <svg viewBox={box.join(" ")} className="office-scene" aria-label="Các room xếp quanh Chief of Staff, mỗi bot ngồi một bàn, vùng sàn chia theo vai của đội">
    <defs>
      <filter id="office-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
      <filter id="office-bloom" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
    <g className="office-grid">
      {grid.map((n) => <g key={n} className={n % 10 === 0 ? "is-major" : undefined}>
        <line x1={project(n, -20)[0]} y1={project(n, -20)[1]} x2={project(n, 20)[0]} y2={project(n, 20)[1]} />
        <line x1={project(-20, n)[0]} y1={project(-20, n)[1]} x2={project(20, n)[0]} y2={project(20, n)[1]} />
      </g>)}
    </g>
    {rooms.map(({ group, members, roles, seats, corners, x0, y0 }) => {
      const goal = latestGoal(group);
      const celebrating = goal?.status === "completed" && goal.finishedAt !== undefined && now - goal.finishedAt < CELEBRATE_MS;
      const x1 = x0 + width, y1 = y0 + depth;
      const [hx, hy] = corners[0]!;
      const [lx, ly] = project(x0 + .5, y1 - .55);
      const kind = group.kind ?? "chat";
      const meta = goal ? `lượt ${goal.turnCount}/${goal.maxTurns}` : `${members.length} bot`;
      const name = clip(group.name, 26);
      const hudWidth = Math.max(textWidth(name, 8.2), textWidth(`${kind}   ${meta}`, 6.4)) + 22;
      const lead = seats.find(({ bot }) => roles[bot.id] === "lead");
      const staged = seats.some(({ stage }) => stage);
      const firstWorking = seats.find((seat) => seat !== lead && seat.job?.state === "running");
      return <g key={group.id} className="office-room" style={{ "--room-hue": ROOM_HUE[kind] } as CSSProperties} data-office-room={group.id}>
        <polygon className="office-plat-side" points={points([project(x1, y0), project(x1, y1), project(x1, y1, -.35), project(x1, y0, -.35)])} />
        <polygon className="office-plat-side" points={points([project(x0, y1), project(x1, y1), project(x1, y1, -.35), project(x0, y1, -.35)])} opacity=".75" />
        <polygon className="office-plat-glow" points={points(corners)} />
        <polygon className="office-platform" points={points(corners)} />
        {staged && ZONES.map((zone, n) => <g key={zone.name} data-office-zone={zone.name}>
          <polygon className={`office-zone is-${n % 2}`} points={points([project(x0 + zone.from, y0), project(x0 + zone.to, y0), project(x0 + zone.to, y1), project(x0 + zone.from, y1)])} />
          <text className="office-zone-text" transform={`matrix(${C} .5 -${C} .5 ${project(x0 + zone.from + .35, y1 - .55)[0].toFixed(1)} ${project(x0 + zone.from + .35, y1 - .55)[1].toFixed(1)})`}>{zone.name}</text>
        </g>)}
        {!staged && <text className="office-floor-text" transform={`matrix(${C} .5 -${C} .5 ${lx.toFixed(1)} ${ly.toFixed(1)})`}>{clip(group.name.toUpperCase(), 22)}</text>}
        {seats.map(({ bot, x, y, state, desk, job }) => <g key={bot.id}>
          <Desk x={x} y={y} on={state === "running"} />
          {state === "running" && <Paper at={[desk[0] + 20, desk[1] + 1]} title={job?.task} />}
          {state === "queued" && [0, 1, 2].map((n) => <Paper key={n} at={[desk[0] + 20, desk[1] + 1 - n * 3]} queued />)}
        </g>)}
        <g role="button" tabIndex={0} aria-label={`Mở room ${group.name}`} className="office-room-label" transform={`translate(${hx - hudWidth / 2} ${hy - 62})`}
          onClick={() => openRoom(group)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRoom(group); } }}>
          <path d={`M0 0 H${hudWidth - 8} L${hudWidth} 8 V44 H8 L0 36 Z`} />
          <text className="office-hud-name" x="11" y="19">{name}</text>
          <text x="11" y="35"><tspan className="office-hud-kind">{kind}</tspan><tspan className="office-meta" dx="10">{meta}</tspan></text>
        </g>
        {seats.map(({ bot, job, state, at }) => {
          const key = `${group.id}:${bot.id}`;
          const role = ROLE_NAME[roles[bot.id] ?? ""];
          const watched = bot === lead?.bot ? firstWorking : state === "running" ? lead : undefined;
          const gaze = watched ? { x: clamp((watched.at[0] - at[0]) / 60), y: clamp((watched.at[1] - at[1]) / 60) * .6 } : undefined;
          const [ax, ay] = at;
          return <g key={key} className="office-bot" data-state={state} role="button" tabIndex={0} aria-pressed={selected === key}
            aria-label={`${bot.name}, ${role ?? "chưa có vai"}, ${OFFICE_STATE[state]}`}
            onClick={() => select(group, bot)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(group, bot); } }}>
            <title>{`${bot.name} · ${bot.modelSelection.model}${job ? ` · ${job.task}` : ""}`}</title>
            <circle className="office-halo" cx={ax} cy={ay} r="25" />
            <circle className="office-ring" cx={ax} cy={ay} r="27" />
            <Figure bot={bot} at={at} gaze={gaze} emotion={faceOf(life[key], state, bot, job, celebrating)} />
            <Pill at={[ax, ay]} name={clip(bot.name, 12)} role={staged ? undefined : role} y={-52} />
          </g>;
        })}
        {seats.flatMap(({ bot, job, at }) => {
          const key = `${group.id}:${bot.id}`;
          const receivedAt = life[key]?.receivedAt;
          if (!job || job.state !== "running" || receivedAt === undefined || now - receivedAt > HOP_MS || stillMotion()) return [];
          const from = lead && lead.bot.id !== bot.id ? lead.at : HUB;
          return [<Hop key={`${key}:${receivedAt}`} from={from} to={at} text={job.task} />];
        })}
      </g>;
    })}
    <g className="office-hub">
      <ellipse className="office-hub-ring" rx="84" ry="48" opacity=".3" />
      <ellipse className="office-hub-spin" rx="62" ry="36" />
      <ellipse className="office-hub-ring office-pulse" rx="40" ry="23" opacity=".8" />
      <circle className="office-hub-core" cy={HUB[1]} r={chief ? 22 : 14} />
      {chief
        ? <Figure bot={chief} at={[0, HUB[1]]} emotion={faceOf(undefined, officeState(chief, undefined), chief, undefined, false)} />
        : <text className="office-initial" y={HUB[1]}>B</text>}
      <Pill at={HUB} name={chief?.name ?? "Bot Management"} role={chief ? "Chief of Staff" : undefined} y={-44} />
    </g>
  </svg>;
}
