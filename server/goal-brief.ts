import type { GoalBrief } from "../shared/group-goal-run.ts";
import { goalStructureText, parseGoalStructure } from "./goal-structure.ts";

const bounded = (value: unknown, max: number): string => typeof value === "string" ? value.trim().slice(0, max) : "";

const BRIEF_LIST_MAX = 8;
const BRIEF_ENTRY_MAX = 240;

export function parseGoalBrief(raw: unknown): GoalBrief | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const goal = bounded(record.goal, 400);
  const list = (value: unknown): string[] | null => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) return null;
    const entries = value.map((item) => bounded(item, BRIEF_ENTRY_MAX));
    return entries.every(Boolean) ? entries.slice(0, BRIEF_LIST_MAX) : null;
  };
  const inScope = list(record.inScope), outOfScope = list(record.outOfScope), acceptance = list(record.acceptance);
  const constraints = list(record.constraints), openQuestions = list(record.openQuestions);
  if (!goal || !inScope || !outOfScope || !acceptance || !constraints || !openQuestions) return undefined;
  const structure = parseGoalStructure(record.structure);
  return { goal, inScope, outOfScope, acceptance, constraints, openQuestions, ...("areas" in structure ? { structure: structure.areas } : {}) };
}

/** Why a brief came without a usable structure, for the Lead to correct. */
export function goalBriefStructureProblem(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const structure = parseGoalStructure((raw as Record<string, unknown>).structure);
  return "problem" in structure ? structure.problem : undefined;
}

export function goalBriefText(brief: GoalBrief): string {
  const section = (label: string, entries: readonly string[]) => entries.length ? [`${label}:`, ...entries.map((entry) => `- ${entry}`)] : [];
  return [
    `Goal: ${brief.goal}`,
    ...section("In scope", brief.inScope),
    ...section("Out of scope", brief.outOfScope),
    ...section("Acceptance", brief.acceptance),
    ...section("Constraints", brief.constraints),
    ...(brief.structure ? [goalStructureText(brief.structure)] : []),
  ].join("\n");
}

