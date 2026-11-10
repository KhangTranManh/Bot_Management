import { describe, expect, it } from "vitest";
import type { HandoffView } from "./coordinator.ts";
import { roomNow } from "./room-now.ts";

const node = (over: Partial<HandoffView>): HandoffView => ({ id: "n", botId: "a", threadId: "lane-a", text: "Build the UI", status: "running", ...over } as HandoffView);

describe("roomNow", () => {
  const base = {
    groupId: "g", roomThreadId: "room", memberIds: ["a", "b", "c"],
    laneRoomThread: (n: HandoffView) => n.threadId.startsWith("lane-") ? "room" : undefined,
    latest: (threadId: string) => threadId === "lane-a" ? { text: "Edit: web/ui.tsx", ok: true } : threadId === "room" ? { text: "Reading the brief" } : undefined,
  };

  it("lists running lane jobs with their newest step, then queued ones, and skips other rooms and non-members", () => {
    const rows = roomNow({ ...base, nodes: [
      node({ id: "1", botId: "a", threadId: "lane-a", startedAt: 10 }),
      node({ id: "2", botId: "b", threadId: "lane-b", status: "queued", text: "Test it" }),
      node({ id: "3", botId: "c", threadId: "elsewhere" }),
      node({ id: "4", botId: "x", threadId: "lane-x" }),
      node({ id: "5", botId: "c", threadId: "lane-c", status: "completed" }),
    ] });
    expect(rows).toEqual([
      { botId: "a", state: "running", task: "Build the UI", threadId: "lane-a", since: 10, step: "Edit: web/ui.tsx", stepOk: true },
      { botId: "b", state: "queued", task: "Test it", threadId: "lane-b" },
    ]);
  });

  it("adds the member speaking in the room thread and keeps one row per member, running first", () => {
    const rows = roomNow({ ...base,
      nodes: [node({ id: "1", botId: "a", status: "queued" }), node({ id: "2", botId: "a", threadId: "lane-a", startedAt: 5 })],
      speaker: { botId: "c", since: 20, task: "Answering in the room" } });
    expect(rows.map((row) => [row.botId, row.state, row.step])).toEqual([["c", "running", "Reading the brief"], ["a", "running", "Edit: web/ui.tsx"]]);
  });
});
