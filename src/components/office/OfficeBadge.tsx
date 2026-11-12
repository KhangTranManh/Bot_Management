import type { ReactNode } from "react";
import type { MausState } from "@/lib/mascot";

/** What each face means, for the hover text. */
export const FACE_LABEL: Partial<Record<MausState, string>> = {
  thinking: "đang nghĩ", searching: "đang đọc, tìm", writing: "đang viết code", working: "đang chạy lệnh", receiving: "vừa nhận việc",
  sending: "vừa giao kết quả", listening: "đang xếp hàng", confused: "bước vừa lỗi", drowsy: "việc đứng yên khá lâu", sleeping: "đang ngủ",
  alerting: "chờ bạn", sad: "hết lượt dùng", celebrate: "goal vừa xong",
};

const dot = (x: number) => <circle key={x} cx={x} cy="0" r="1.4" fill="currentColor" stroke="none" />;

/** A 16 x 16 glyph centred on the origin, drawn in the bot's state colour. */
const GLYPH: Partial<Record<MausState, ReactNode>> = {
  thinking: [-4, 0, 4].map(dot),
  searching: <><circle cx="-1" cy="-1" r="3.4" /><path d="M1.6 1.6L5 5" /></>,
  writing: <><path d="M-4 4L-3.2 1L3 -5L5 -3L-1.2 3.2Z" /><path d="M1 -3L3 -1" /></>,
  working: <><path d="M-5 -3L-1 0L-5 3" /><path d="M0 3.5H5" /></>,
  receiving: <><path d="M0 -5V2" /><path d="M-3 -1L0 2L3 -1" /><path d="M-5 4.5H5" /></>,
  sending: <><path d="M-4 4L4 -4" /><path d="M-1 -4H4V1" /></>,
  listening: <path d="M-3 -5H3M-3 5H3M-3 -5L3 5M3 -5L-3 5" />,
  confused: <text className="office-badge-char" y="0.5">?</text>,
  drowsy: <text className="office-badge-char" y="0.5">z</text>,
  sleeping: <text className="office-badge-char" y="0.5">zZ</text>,
  alerting: <text className="office-badge-char" y="0.5">!</text>,
  sad: <><rect x="-5" y="-3" width="9" height="6" rx="1" /><path d="M4.6 -1.2V1.2" /></>,
  celebrate: <path d="M0 -6L1.5 -1.5L6 0L1.5 1.5L0 6L-1.5 1.5L-6 0L-1.5 -1.5Z" fill="currentColor" />,
};

/** The small round sign beside a bot's head that says what its face means; nothing for an idle bot. */
export function OfficeBadge({ face, at: [x, y] }: { face: MausState; at: [number, number] }) {
  const glyph = GLYPH[face];
  if (!glyph) return null;
  return <g className="office-badge" data-badge={face} transform={`translate(${(x + 21).toFixed(1)} ${(y - 21).toFixed(1)})`}>
    <title>{FACE_LABEL[face]}</title>
    <circle className="office-badge-bg" r="10" />
    <g className="office-badge-glyph">{glyph}</g>
  </g>;
}
