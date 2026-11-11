import { describe, expect, it } from "vitest";
import { editedPaths } from "./edit-events.ts";

const event = (title: string, input: unknown, createdAt = "2026-11-11T14:50:00.000Z") =>
  JSON.stringify({ type: "item.started", itemType: "tool", title, createdAt, input: typeof input === "string" ? input : JSON.stringify(input, null, 2) });

describe("editedPaths", () => {
  it("reads Claude and Codex edits, not reads or shell commands, and only since the time given", () => {
    const log = [
      event("Write", { file_path: "D:\\shop\\work\\tests\\helpers.mjs", content: "x" }),
      event("Edit", { file_path: "D:\\shop\\work\\src\\server.js", old_string: "a", new_string: "b" }),
      event("edit", [{ path: "D:\\shop\\work\\public\\index.html", kind: { type: "add" }, diff: "<!doctype html>" }]),
      event("Read", { file_path: "D:\\shop\\work\\SPEC.md" }),
      event("Bash", { command: "echo hi > src/other.js" }),
      event("Edit", { file_path: "D:\\shop\\work\\old.js" }, "2026-11-11T14:00:00.000Z"),
      "not json",
    ].join("\n");
    expect(editedPaths(log, Date.parse("2026-11-11T14:30:00.000Z")).sort()).toEqual([
      "D:/shop/work/public/index.html", "D:/shop/work/src/server.js", "D:/shop/work/tests/helpers.mjs",
    ]);
  });

  it("still finds the path in an input the log cut short", () => {
    const cut = `{\n  "file_path": "D:\\\\shop\\\\work\\\\src\\\\cart.js",\n  "content": "export function add(`;
    expect(editedPaths(event("Write", cut), 0)).toEqual(["D:/shop/work/src/cart.js"]);
  });
});
