import type { GoalArea } from "../shared/group-goal-run.ts";
import type { LeadTaskPlan } from "./lead-schedule.ts";

const MAX_AREAS = 12;
const MAX_PATHS = 16;

const normalize = (path: string): string => path.trim().replace(/\\/g, "/").replace(/^\.\/(?=.)/, "").replace(/\/+$/, "") || ".";
const inside = (path: string, area: string): boolean => area === "." || path === area || path.startsWith(`${area}/`);
const bounded = (value: unknown, max: number): string => typeof value === "string" ? value.trim().slice(0, max) : "";

/** The Lead's structure, or why it cannot be used: names unique, every path relative and inside the project, no two
 * areas sharing a path. */
export function parseGoalStructure(raw: unknown): { areas: GoalArea[] } | { problem: string } {
  if (raw === undefined || raw === null) return { problem: "the brief has no structure" };
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_AREAS) return { problem: `the structure must list 1 to ${MAX_AREAS} areas` };
  const areas: GoalArea[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { problem: "each structure area is an object with name, paths and owns" };
    const record = entry as Record<string, unknown>;
    const name = bounded(record.name, 40);
    const owns = bounded(record.owns, 200);
    if (!name || !owns) return { problem: "each structure area needs a name and what it owns" };
    if (areas.some((area) => area.name.toLowerCase() === name.toLowerCase())) return { problem: `two structure areas are named ${name}` };
    if (!Array.isArray(record.paths) || record.paths.length === 0 || record.paths.length > MAX_PATHS) return { problem: `area ${name} needs 1 to ${MAX_PATHS} paths` };
    const paths: string[] = [];
    for (const value of record.paths) {
      if (typeof value !== "string" || !value.trim() || value.length > 200) return { problem: `area ${name} has an empty or overlong path` };
      const path = normalize(value);
      if (path.split("/").includes("..") || /^\/|^[A-Za-z]:/.test(path)) return { problem: `area ${name} names ${value}, which is outside the project; use relative paths` };
      if (!paths.includes(path)) paths.push(path);
    }
    areas.push({ name, paths, owns, ...(record.readOnly === true ? { readOnly: true } : {}) });
  }
  for (const [index, area] of areas.entries()) {
    for (const other of areas.slice(index + 1)) {
      const shared = area.paths.flatMap((path) => other.paths.filter((theirs) => inside(path, theirs) || inside(theirs, path)).map((theirs) => [path, theirs]))[0];
      if (shared) return { problem: `areas ${area.name} and ${other.name} overlap at ${shared[0]} and ${shared[1]}; give each path to one area` };
    }
  }
  return { areas };
}

/** The area a written path falls in; with no overlapping areas there is at most one. */
export function areaOf(path: string, areas: readonly GoalArea[]): GoalArea | undefined {
  const target = normalize(path);
  return areas.find((area) => area.paths.some((owned) => inside(target, owned)));
}

/** Why a Worker task breaks the structure: a write outside every area, into a read-only area, or across two areas. */
export function structureTaskProblem(tasks: ReadonlyArray<{ plan: LeadTaskPlan; name: string; worker: boolean }>, areas: readonly GoalArea[]): string | undefined {
  for (const { plan, name, worker } of tasks) {
    if (!worker) continue;
    const touched: string[] = [];
    for (const write of plan.writes ?? []) {
      const area = areaOf(write, areas);
      if (!area) return `task ${plan.id} for ${name} writes ${write}, which is in no area of the structure; list files inside one area, or add the path to an area`;
      if (area.readOnly) return `task ${plan.id} for ${name} writes ${write} in ${area.name}, which is read-only`;
      if (!touched.includes(area.name)) touched.push(area.name);
    }
    if (touched.length > 1) return `task ${plan.id} for ${name} writes in ${touched.join(" and ")}; a task works in one area, so split it into one task per area`;
  }
  return undefined;
}

export function goalStructureText(areas: readonly GoalArea[]): string {
  return [
    "Project structure (each Worker task writes inside one area; read-only areas take no writes):",
    ...areas.map((area) => `- ${area.name}${area.readOnly ? " (read-only)" : ""}: ${area.paths.join(", ")} — ${area.owns}`),
  ].join("\n");
}
