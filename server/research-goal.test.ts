import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadResearchGoal, researchBudgetExceeded } from "./research-goal.ts";

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
