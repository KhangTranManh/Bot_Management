// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";

const mocks = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn(), allowed: true }));
vi.mock("@/state/store", () => ({ api: mocks.api, useStore: () => ({ dispatch: mocks.dispatch }) }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => mocks.allowed }));
const { GoalBranchControls } = await import("./GoalBranchControls");
let root: Root;
let host: HTMLDivElement;
let message: Message;
const render = () => flushSync(() => root.render(createElement(GoalBranchControls, { message, groupId: "room", threadId: "thread" })));
const button = (label: string) => [...host.querySelectorAll("button")].find((button) => button.textContent === label)!;
const click = (label: string) => flushSync(() => button(label).click());
beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  message = { id: "card", at: 1, role: "bot", kind: "goal.run", goalRun: { runId: "run", goal: "Build", status: "completed", coordinatorBotId: "lead", coordinatorName: "Lead", turnCount: 4, maxTurns: 13, startedAt: 1, branches: { runId: "run", branch: "omb/fixture/integration", originalBranch: "main", head: "a".repeat(40), decision: "pending", tasks: [] } } };
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

it("requires confirmation for the exact reviewed head and keeps cancellation harmless", async () => {
  render(); click("Merge vào branch gốc");
  expect(mocks.api).not.toHaveBeenCalled();
  expect(document.activeElement?.textContent).toBe("Huỷ");
  click("Huỷ"); expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  expect(mocks.api).not.toHaveBeenCalled();
  click("Merge vào branch gốc");
  mocks.api.mockResolvedValue({ branches: { ...message.goalRun!.branches!, decision: "merged" } });
  click("Xác nhận merge");
  await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalled());
  expect(mocks.api).toHaveBeenCalledWith("/api/groups/room/tasks/thread/goals/card/branches", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "merge", head: "a".repeat(40), confirm: true }) }));
});

it("does not reuse an open confirmation when the branch head changes", () => {
  render(); click("Bỏ branch");
  message = { ...message, goalRun: { ...message.goalRun!, branches: { ...message.goalRun!.branches!, head: "b".repeat(40) } } };
  render(); click("Xác nhận bỏ");
  expect(mocks.api).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Branch đã đổi");
});

it("does not reuse confirmation for another card at the same head", () => {
  render(); click("Bỏ branch");
  message = { ...message, id: "other-card" };
  render(); click("Xác nhận bỏ");
  expect(mocks.api).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Branch đã đổi");
});

it("removes a pending confirmation when the current user loses permission", () => {
  render(); click("Bỏ branch"); mocks.allowed = false; render();
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(mocks.api).not.toHaveBeenCalled();
});

it("retains a failed decision for retry and hides mutation controls from a viewer", async () => {
  render(); click("Bỏ branch"); mocks.api.mockRejectedValue(new Error("Original HEAD changed")); click("Xác nhận bỏ");
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain("Original HEAD changed"));
  expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
  click("Huỷ"); mocks.allowed = false; render();
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(host.textContent).toContain("Branch đang được giữ");
});
