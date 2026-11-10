import type { TeamRole } from "./team-roles.ts";

/** Opening words of a request for work, in Vietnamese and English, optionally after a polite lead-in. */
const WORK_REQUEST = /^(?:(?:hãy|giúp|nhờ|cho|please|pls|can you|could you)\s+(?:(?:mình|tôi|t|em|anh|chị|me|us)\s+)?)?(?:làm|sửa|thêm|tạo|xây|xây dựng|viết|triển khai|cài|cài đặt|nâng cấp|chuyển|tối ưu|fix|build|add|create|implement|make|write|update|set up|setup|deploy|migrate|refactor|port)(?=[\s,.:;!]|$)/iu;

/** A message that asks for work rather than an answer: long enough, not a question, naming no one, opening with a work verb. */
export function looksLikeWorkRequest(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12 || /[?？]\s*$/u.test(trimmed) || /(^|\s)@\S/u.test(trimmed)) return false;
  return WORK_REQUEST.test(trimmed);
}

/** Whether a room runs work requests as goals: its own switch, or on once it has a Lead. */
export function autoGoalOn(room: { autoGoal?: boolean; roles?: Readonly<Record<string, TeamRole>> }): boolean {
  return room.autoGoal ?? Object.values(room.roles ?? {}).includes("lead");
}

const PROGRESS_QUESTION = /(tình hình|tiến độ|tiến triển|đang làm gì|làm tới đâu|tới đâu rồi|đến đâu rồi|xong chưa|sao rồi|\bstatus\b|\bprogress\b|how(?:'s| is) it going|where are we|what(?:'s| is) everyone doing)/iu;

/** A short question about how the room's work is going, naming no one. */
export function looksLikeProgressQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 80 && !/(^|\s)@\S/u.test(trimmed) && PROGRESS_QUESTION.test(trimmed);
}
