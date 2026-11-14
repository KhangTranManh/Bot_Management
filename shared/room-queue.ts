export interface RoomQueueEntry {
  botId: string;
  threadId: string;
  state: "running" | "queued";
  /** 1-based place in that thread's line; `of` counts the whole line. */
  position: number;
  of: number;
  /** Who a queued member waits on: the member running now, else the one speaking (or the one ahead). */
  waitingForBotId?: string;
  assignmentId?: string;
}

/** One member's hold in a room: when the person stopped it, and whether the
 * room has already said so (the held line is written once per hold). */
export interface RoomHold {
  at: number;
  noted?: boolean;
}

/** A room message that reached a member while it was held. */
export interface RoomHeldMessage {
  threadId: string;
  messageId: string;
}

/** Why a steer-queue entry waits: a shared thread slot, or the bot's room
 * turn (which runs one at a time per bot). */
export type SteerQueueReason = "capacity" | "group-turn";

/** Pending steer-queue chips, as `queuedSteerSnapshot` emits them and the
 * `bot.queued` frame carries them: threadId → queued items. */
export type BotQueuedMessages = Record<string, Array<{ queueId: string; text: string; reason?: SteerQueueReason; /** The reason in plain words, shown as it is. */ why?: string }>>;
