import { describe, expect, it } from "vitest";
import { checkedProjectProfile, goalCheckResult, projectContext } from "./room-project.ts";

describe("room project profiles", () => {
  it("bounds project context and validates setup as server commands", () => {
    expect(checkedProjectProfile({ instructions: " Follow AGENTS.md ", moduleMap: " src: app ", protectedPaths: ["./vendor/", "db\\migrations"], setup: [{ id: "deps", command: "npm ci", timeoutSec: 60 }] }))
      .toEqual({ instructions: "Follow AGENTS.md", moduleMap: "src: app", protectedPaths: ["vendor", "db/migrations"], setup: [{ id: "deps", command: "npm ci", timeoutSec: 60 }] });
    expect(checkedProjectProfile({})).toEqual({});
  });

  it.each([
    null, [], "project", { instructions: 1 }, { moduleMap: "x".repeat(4001) }, { unknown: true },
    { protectedPaths: ["../secret"] }, { protectedPaths: ["/etc"] }, { protectedPaths: ["C:\\private"] }, { protectedPaths: ["./"] },
    { protectedPaths: [false] }, { protectedPaths: Array(17).fill("vendor") },
    { setup: [] }, { setup: [{ id: "deps", command: "npm ci", cwd: "../outside" }] },
    { setup: [{ id: "deps", command: "npm ci", timeoutSec: 0 }] },
  ])("refuses malformed or out-of-folder profiles: %j", (raw) => {
    expect(() => checkedProjectProfile(raw)).toThrow(/projectProfile/);
  });

  it("redacts baseline output and labels a missing verify list as unverified", () => {
    const secret = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const check = goalCheckResult({ id: "tests", command: "npm test" }, { id: "tests", exitCode: 1, output: `old failure ${secret}` });
    expect(check.output).not.toContain(secret);
    const baseline = { startedAt: 1, finishedAt: 2, setup: [], checks: [check] };
    const context = projectContext({ instructions: "Readable code", protectedPaths: ["vendor"] }, [{ id: "tests", command: "npm test" }], baseline);
    expect(context).toContain("tests: FAIL, exit 1");
    expect(context).toContain("final completion checks must still pass");
    expect(context).toContain("Do not edit these project paths: vendor");
    expect(projectContext({}, [], { ...baseline, checks: [] })).toContain("baseline is unverified");
  });
});
