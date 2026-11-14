import { describe, expect, it } from "vitest";
import { areaOf, goalStructureText, parseGoalStructure, structureTaskProblem } from "./goal-structure.ts";

const web = [
  { name: "db", paths: ["server/db/"], owns: "schema and queries" },
  { name: "backend", paths: ["server/routes", "server/index.js"], owns: "HTTP and auth" },
  { name: "frontend", paths: ["./web/src/"], owns: "screens" },
  { name: "tests", paths: ["tests"], owns: "contract tests", readOnly: true },
];
const areas = (raw: unknown) => {
  const parsed = parseGoalStructure(raw);
  if (!("areas" in parsed)) throw new Error(parsed.problem);
  return parsed.areas;
};
const task = (id: string, writes: string[], worker = true) => ({ plan: { id, assignee: "w", instruction: "do", writes }, name: "Terra", worker });

describe("the Lead's structure", () => {
  it("keeps areas with normalized paths and the read-only mark", () => {
    expect(areas(web)).toEqual([
      { name: "db", paths: ["server/db"], owns: "schema and queries" },
      { name: "backend", paths: ["server/routes", "server/index.js"], owns: "HTTP and auth" },
      { name: "frontend", paths: ["web/src"], owns: "screens" },
      { name: "tests", paths: ["tests"], owns: "contract tests", readOnly: true },
    ]);
    expect(areas([{ name: "project", paths: ["./"], owns: "everything" }])[0]!.paths).toEqual(["."]);
  });

  it("refuses a missing, empty, nameless, duplicated, outside or overlapping structure with the reason", () => {
    const problem = (raw: unknown) => { const parsed = parseGoalStructure(raw); return "problem" in parsed ? parsed.problem : ""; };
    expect(problem(undefined)).toBe("the brief has no structure");
    expect(problem([])).toMatch(/1 to 12 areas/);
    expect(problem([{ paths: ["a"], owns: "x" }])).toMatch(/needs a name/);
    expect(problem([{ name: "a", paths: ["x"], owns: "x" }, { name: "A", paths: ["y"], owns: "y" }])).toMatch(/two structure areas are named A/);
    expect(problem([{ name: "a", paths: ["../up"], owns: "x" }])).toMatch(/outside the project/);
    expect(problem([{ name: "a", paths: ["C:/repo"], owns: "x" }])).toMatch(/outside the project/);
    expect(problem([{ name: "a", paths: [], owns: "x" }])).toMatch(/1 to 16 paths/);
    expect(problem([{ name: "server", paths: ["server"], owns: "x" }, { name: "db", paths: ["server/db"], owns: "y" }])).toBe("areas server and db overlap at server and server/db; give each path to one area");
    expect(problem([{ name: "all", paths: ["."], owns: "x" }, { name: "db", paths: ["db"], owns: "y" }])).toMatch(/overlap/);
  });

  it("finds a write's area by folder, not by name prefix", () => {
    const parsed = areas(web);
    expect(areaOf("server/db/schema.js", parsed)?.name).toBe("db");
    expect(areaOf("server\\index.js", parsed)?.name).toBe("backend");
    expect(areaOf("server/dbtools.js", parsed)).toBeUndefined();
    expect(areaOf("web/src", parsed)?.name).toBe("frontend");
  });

  it("holds each Worker task to one writable area and leaves Tester and Reviewer tasks alone", () => {
    const parsed = areas(web);
    expect(structureTaskProblem([task("t1", ["server/db/schema.js", "server/db/queries.js"]), task("t2", ["web/src/App.jsx"]), task("test", ["tests/x"], false)], parsed)).toBeUndefined();
    expect(structureTaskProblem([task("t1", ["server/db/schema.js", "web/src/App.jsx"])], parsed))
      .toBe("task t1 for Terra writes in db and frontend; a task works in one area, so split it into one task per area");
    expect(structureTaskProblem([task("t1", ["tests/acceptance.test.mjs"])], parsed)).toBe("task t1 for Terra writes tests/acceptance.test.mjs in tests, which is read-only");
    expect(structureTaskProblem([task("t1", ["package.json"])], parsed)).toMatch(/^task t1 for Terra writes package.json, which is in no area/);
  });

  it("reads as one line per area", () => {
    expect(goalStructureText(areas(web))).toBe([
      "Project structure (each Worker task writes inside one area; read-only areas take no writes):",
      "- db: server/db — schema and queries",
      "- backend: server/routes, server/index.js — HTTP and auth",
      "- frontend: web/src — screens",
      "- tests (read-only): tests — contract tests",
    ].join("\n"));
  });
});
