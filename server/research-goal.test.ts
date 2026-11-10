import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateMetric,
  appendResearchLedger,
  heldOutMentions,
  loadResearchGoal,
  readResearchMetric,
  researchBudgetExceeded,
  researchHistory,
  researchStopReason,
} from "./research-goal.ts";

const validGoal = {
  name: "Phase 16 sweep",
  metric: { file: "results/metrics.json", pointer: "/primary/accuracy", threshold: 0.72, direction: "at-least" },
  seeds: { count: 3, aggregation: "mean" },
  budget: { wallMinutes: 90 },
  verify: [{ id: "suite", command: "node scripts/score.js", expectExit: 0 }],
};

describe("loadResearchGoal", () => {
  it("accepts a valid file and hashes its exact bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-research-goal-"));
    try {
      const path = join(dir, "goal.json");
      writeFileSync(path, JSON.stringify(validGoal));
      const loaded = loadResearchGoal(path);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.goal.metric.threshold).toBe(0.72);
        expect(loaded.goal.verify).toHaveLength(1);
        expect(loaded.hash).toMatch(/^[0-9a-f]{64}$/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a file missing the primary metric, seeds or budget, naming the path", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-research-goal-"));
    try {
      const path = join(dir, "goal.json");
      writeFileSync(path, JSON.stringify({ name: "Half a goal", verify: validGoal.verify }));
      const loaded = loadResearchGoal(path);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.error).toContain("metric");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hashes content, not mtime: rewriting the same bytes keeps the hash, edits change it", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-research-goal-"));
    try {
      const path = join(dir, "goal.json");
      writeFileSync(path, JSON.stringify(validGoal));
      const first = loadResearchGoal(path);
      writeFileSync(path, JSON.stringify(validGoal));
      const rewritten = loadResearchGoal(path);
      const tampered = loadResearchGoal((writeFileSync(path, JSON.stringify({ ...validGoal, metric: { ...validGoal.metric, threshold: 0.9 } })), path));
      expect(first.ok && rewritten.ok && tampered.ok).toBe(true);
      if (first.ok && rewritten.ok && tampered.ok) {
        expect(rewritten.hash).toBe(first.hash);
        expect(tampered.hash).not.toBe(first.hash);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing file and invalid JSON without throwing", () => {
    expect(loadResearchGoal(join(tmpdir(), "omb-nowhere", "goal.json")).ok).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "omb-research-goal-"));
    try {
      const path = join(dir, "goal.json");
      writeFileSync(path, "{not json");
      expect(loadResearchGoal(path).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("researchBudgetExceeded", () => {
  it("fires only after the wall minutes are spent", () => {
    expect(researchBudgetExceeded(0, 90)).toBe(false);
    expect(researchBudgetExceeded(89 * 60_000, 90)).toBe(false);
    expect(researchBudgetExceeded(91 * 60_000, 90)).toBe(true);
  });
});

describe("research metric", () => {
  it("aggregates per-seed values and refuses too few seeds or a lone number for several seeds", () => {
    expect(aggregateMetric([0.7, 0.8, 0.9], { count: 3, aggregation: "mean" })).toEqual({ ok: true, value: expect.closeTo(0.8, 10) });
    expect(aggregateMetric([0.7, 0.8, 0.9], { count: 3, aggregation: "min" })).toEqual({ ok: true, value: 0.7 });
    expect(aggregateMetric([0.7, 0.8], { count: 3, aggregation: "max" }).ok).toBe(false);
    expect(aggregateMetric(0.8, { count: 1, aggregation: "mean" })).toEqual({ ok: true, value: 0.8 });
    expect(aggregateMetric(0.8, { count: 3, aggregation: "mean" }).ok).toBe(false);
    expect(aggregateMetric("0.8", { count: 1, aggregation: "mean" }).ok).toBe(false);
  });

  it("reads the metric through its JSON pointer in the room folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-research-metric-"));
    try {
      mkdirSync(join(dir, "results"));
      writeFileSync(join(dir, "results", "metrics.json"), JSON.stringify({ primary: { accuracy: [0.7, 0.74, 0.78] } }));
      const goal = { ...validGoal, metric: { ...validGoal.metric, direction: "at-least" as const } } as Parameters<typeof readResearchMetric>[1];
      expect(readResearchMetric(dir, goal)).toEqual({ ok: true, value: expect.closeTo(0.74, 10) });
      expect(readResearchMetric(dir, { ...goal, metric: { ...goal.metric, pointer: "/primary/f1" } }).ok).toBe(false);
      expect(readResearchMetric(join(dir, "nowhere"), goal).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops after the round cap or after flat rounds, in the metric's direction", () => {
    const metric = { threshold: 0.9, direction: "at-least" as const };
    expect(researchStopReason([0.5, 0.6], { metric, maxExperimentRounds: 3 })).toBeUndefined();
    expect(researchStopReason([0.5, 0.6, 0.65], { metric, maxExperimentRounds: 3 })).toContain("3 experiment rounds");
    expect(researchStopReason([0.6, 0.55, 0.58], { metric, stopAfterFlatRounds: 2 })).toContain("did not beat 0.6");
    expect(researchStopReason([0.6, 0.55, 0.61], { metric, stopAfterFlatRounds: 2 })).toBeUndefined();
    expect(researchStopReason([2.0, 1.5, 1.4], { metric: { threshold: 1, direction: "at-most" }, stopAfterFlatRounds: 2 })).toBeUndefined();
  });
});

describe("research ledger history", () => {
  it("adds up active time and metric readings of runs on the same approved hash only", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-research-ledger-"));
    try {
      const ledger = join(dir, "research", "room.jsonl");
      const lines = [
        { at: 1_000, runId: "r1", kind: "run-start", hash: "h1" },
        { at: 2_000, runId: "r1", kind: "metric", hash: "h1", value: 0.6 },
        { at: 61_000, runId: "r1", kind: "run-end" },
        { at: 70_000, runId: "r2", kind: "run-start", hash: "h1" },
        { at: 100_000, runId: "r2", kind: "verify", id: "suite", exitCode: 1 },
        { at: 200_000, runId: "r3", kind: "run-start", hash: "other" },
        { at: 900_000, runId: "r3", kind: "run-end" },
      ];
      for (const line of lines) appendResearchLedger(ledger, line);
      expect(researchHistory(ledger, "h1")).toEqual({ spentMs: 60_000 + 30_000, metricValues: [0.6] });
      expect(researchHistory(join(dir, "none.jsonl"), "h1")).toEqual({ spentMs: 0, metricValues: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("heldOutMentions", () => {
  const event = (fields: Record<string, unknown>) => JSON.stringify({ type: "item.started", itemType: "tool", createdAt: "2026-11-11T10:00:00.000Z", providerInstanceId: "inst-a", ...fields });

  it("counts only the bot's own tool calls since the turn began, matching either slash style", () => {
    const since = Date.parse("2026-11-11T09:59:00.000Z");
    const log = [
      event({ summary: "python eval.py --data data\\heldout\\test.jsonl" }),
      JSON.stringify({ type: "item.completed", itemType: "assistant_text", createdAt: "2026-11-11T10:00:01.000Z", text: "I will not open data/heldout/test.jsonl" }),
      event({ summary: "cat secret/answers.csv", providerInstanceId: "inst-b" }),
      event({ summary: "cat secret/answers.csv", createdAt: "2026-11-11T09:00:00.000Z" }),
    ].join("\n");
    expect(heldOutMentions(log, ["data/heldout/test.jsonl", "secret/answers.csv"], since, "inst-a")).toEqual(["data/heldout/test.jsonl"]);
    expect(heldOutMentions(log, ["secret/answers.csv"], since, "inst-b")).toEqual(["secret/answers.csv"]);
  });
});
