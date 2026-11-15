import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GroupGoalRunCardData } from "../../../shared/group-goal-run";
import { GoalRunRecord } from "./GoalRunRecord";

const run = (planSource?: GroupGoalRunCardData["planSource"]): GroupGoalRunCardData => ({
  runId: "r", goal: "Ship", status: "working", coordinatorBotId: "l", coordinatorName: "Lead", turnCount: 1, maxTurns: 13, startedAt: 1,
  ...(planSource ? { planSource } : {}),
});
const brief = { goal: "Ship", inScope: [], outOfScope: [], acceptance: ["Works"], constraints: [], openQuestions: [] };
const draft = { brief, waves: [{ name: "Foundation", areas: ["backend"], deliverable: "API" }] };

describe("the goal record's saved outline", () => {
  it("shows where the outline came from, its waves and the Lead's reason for changing the brief", () => {
    const html = renderToStaticMarkup(createElement(GoalRunRecord, { run: run({ source: "conversation", cardId: "c", draft, changeReason: "Refunds added" }) }));
    expect(html).toContain("data-goal-plan-source");
    expect(html).toContain("Từ thẻ phác thảo trong cuộc trò chuyện");
    expect(html).toContain('data-plan-wave="Foundation"');
    expect(html).toContain("Lead đổi brief: Refunds added");
  });

  it("shows the profile source without a reason, and nothing without an outline", () => {
    const html = renderToStaticMarkup(createElement(GoalRunRecord, { run: run({ source: "profile", draft }) }));
    expect(html).toContain("Từ hồ sơ dự án");
    expect(html).not.toContain("data-plan-change-reason");
    expect(renderToStaticMarkup(createElement(GoalRunRecord, { run: run() }))).toBe("");
  });
});
