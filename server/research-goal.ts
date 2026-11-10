import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

/** A research room's preregistered goal file (NOTE.md B2/B8, §8.8): the person writes it, the server
 * validates it against this schema and locks its hash at approval; every later run re-checks the hash. */
export const researchGoalSchema = z.object({
  name: z.string().min(1).max(200),
  /** The one metric that decides "done": where it lives and the threshold it must clear. */
  metric: z.object({
    file: z.string().min(1),
    pointer: z.string().min(1),
    threshold: z.number(),
    direction: z.enum(["at-least", "at-most"]),
  }),
  seeds: z.object({
    count: z.number().int().positive(),
    aggregation: z.enum(["mean", "min", "max"]),
  }),
  /** The wall-clock budget the server guards; running out is a valid negative result, not a crash. */
  budget: z.object({ wallMinutes: z.number().positive() }),
  maxExperimentRounds: z.number().int().positive().optional(),
  stopAfterFlatRounds: z.number().int().positive().optional(),
  /** The completion checks (B0(ii)) — in a research room these come from here, never from the Lead. */
  verify: z.array(z.object({
    id: z.string().min(1).max(60),
    command: z.string().min(1).max(2_000),
    cwd: z.string().max(200).optional(),
    timeoutSec: z.number().positive().max(3_600).optional(),
    expectExit: z.number().int().optional(),
  })).min(1).max(8),
  /** Paths of the held-out evaluation set (B3): an Evaluator touching them is reported after the fact. */
  heldOutPaths: z.array(z.string().min(1)).max(32).optional(),
});

export type ResearchGoalFile = z.infer<typeof researchGoalSchema>;

export type LoadedResearchGoal =
  | { ok: true; goal: ResearchGoalFile; hash: string }
  | { ok: false; error: string };

export function loadResearchGoal(absPath: string): LoadedResearchGoal {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return { ok: false, error: `the research goal file is missing or unreadable: ${absPath}` };
  }
  const hash = createHash("sha256").update(raw).digest("hex");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { ok: false, error: "the research goal file is not valid JSON" };
  }
  const parsed = researchGoalSchema.safeParse(parsedJson);
  return parsed.success
    ? { ok: true, goal: parsed.data, hash }
    : { ok: false, error: `the research goal file breaks its schema: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}` };
}

/** The server's wall-clock budget guard (B7): true once the goal has run longer than the file allows. */
export function researchBudgetExceeded(elapsedMs: number, wallMinutes: number): boolean {
  return elapsedMs > wallMinutes * 60_000;
}
