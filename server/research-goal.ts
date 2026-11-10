import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

/** A research room's preregistered goal file: the person writes it, the server validates it against this schema
 * and locks its hash at approval; every later run re-checks the hash. */
export const researchGoalSchema = z.object({
  name: z.string().min(1).max(200),
  /** The one metric that decides "done": a JSON file in the room folder, a JSON pointer into it, and the threshold. */
  metric: z.object({
    file: z.string().min(1),
    pointer: z.string().min(1),
    threshold: z.number(),
    direction: z.enum(["at-least", "at-most"]),
  }),
  /** The pointer names one number when count is 1, else an array of at least `count` per-seed numbers. */
  seeds: z.object({
    count: z.number().int().positive(),
    aggregation: z.enum(["mean", "min", "max"]),
  }),
  /** Active run time across every run of this approved file; running out is a valid negative result. */
  budget: z.object({ wallMinutes: z.number().positive() }),
  /** The run's first accepted plan may schedule at most this many tasks. */
  pilot: z.object({ maxTasks: z.number().int().positive() }).optional(),
  /** The Lead may not call completed while these files are missing from the room folder. */
  handoff: z.object({ expectsFiles: z.array(z.string().min(1)).min(1).max(16) }).optional(),
  /** Metric checks that may miss the threshold before the research stops with a negative result. */
  maxExperimentRounds: z.number().int().positive().optional(),
  /** Consecutive metric checks without beating the best so far before the research stops. */
  stopAfterFlatRounds: z.number().int().positive().optional(),
  /** Completion checks; in a research room they come from here, never from the Lead or the room. */
  verify: z.array(z.object({
    id: z.string().min(1).max(60),
    command: z.string().min(1).max(2_000),
    cwd: z.string().max(200).optional(),
    timeoutSec: z.number().positive().max(3_600).optional(),
    expectExit: z.number().int().optional(),
  })).min(1).max(8),
  /** Paths of the held-out evaluation set; a member's tool call naming one is reported after the fact. */
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

export function researchBudgetExceeded(elapsedMs: number, wallMinutes: number): boolean {
  return elapsedMs > wallMinutes * 60_000;
}

export type MetricReading = { ok: true; value: number } | { ok: false; reason: string };

function pointerGet(document: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return document;
  const parts = pointer.replace(/^\//, "").split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let at: unknown = document;
  for (const part of parts) {
    if (at === null || typeof at !== "object" || !Object.prototype.hasOwnProperty.call(at, part)) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

export function aggregateMetric(raw: unknown, seeds: ResearchGoalFile["seeds"]): MetricReading {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return seeds.count === 1 ? { ok: true, value: raw } : { ok: false, reason: `found one number where the goal file expects ${seeds.count} seed values` };
  }
  if (!Array.isArray(raw) || !raw.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return { ok: false, reason: "the metric is neither a number nor a list of numbers" };
  }
  const values = raw as number[];
  if (values.length < seeds.count) return { ok: false, reason: `found ${values.length} seed values, the goal file expects ${seeds.count}` };
  const value = seeds.aggregation === "min" ? Math.min(...values)
    : seeds.aggregation === "max" ? Math.max(...values)
      : values.reduce((sum, v) => sum + v, 0) / values.length;
  return { ok: true, value };
}

export function readResearchMetric(folder: string, goal: ResearchGoalFile): MetricReading {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(join(folder, goal.metric.file), "utf8"));
  } catch {
    return { ok: false, reason: `${goal.metric.file} is missing or not valid JSON` };
  }
  const raw = pointerGet(document, goal.metric.pointer);
  if (raw === undefined) return { ok: false, reason: `${goal.metric.file} has nothing at ${goal.metric.pointer}` };
  return aggregateMetric(raw, goal.seeds);
}

type MetricTarget = Pick<ResearchGoalFile["metric"], "threshold" | "direction">;

export function metricMeetsThreshold(value: number, metric: MetricTarget): boolean {
  return metric.direction === "at-least" ? value >= metric.threshold : value <= metric.threshold;
}

/** Why the research stops with a negative result after these metric readings (oldest first), if it does. */
export function researchStopReason(values: readonly number[], goal: { metric: MetricTarget; maxExperimentRounds?: number; stopAfterFlatRounds?: number }): string | undefined {
  if (goal.maxExperimentRounds !== undefined && values.length >= goal.maxExperimentRounds) {
    return `${values.length} experiment rounds missed the threshold (the goal file allows ${goal.maxExperimentRounds})`;
  }
  const flat = goal.stopAfterFlatRounds;
  if (flat !== undefined && values.length > flat) {
    const better = (a: number, b: number) => goal.metric.direction === "at-least" ? a > b : a < b;
    const before = values.slice(0, values.length - flat);
    const best = before.reduce((acc, v) => (better(v, acc) ? v : acc));
    if (!values.slice(-flat).some((v) => better(v, best))) return `the last ${flat} experiment rounds did not beat ${best}`;
  }
  return undefined;
}

/** The server's ledger lives in the app's data folder, outside every bot's working folder. */
export function researchLedgerPath(dataDir: string, groupId: string): string {
  return join(dataDir, "research", `${groupId}.jsonl`);
}

export function appendResearchLedger(ledgerPath: string, entry: Record<string, unknown>): void {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  appendFileSync(ledgerPath, `${JSON.stringify({ at: Date.now(), ...entry })}\n`, { mode: 0o600 });
}

export interface ResearchHistory {
  /** Active run time already spent on this approved file. */
  spentMs: number;
  /** Metric readings already taken on this approved file, oldest first. */
  metricValues: number[];
}

/** What earlier runs of the same approved goal file spent, read back from the ledger. A run without a
 * run-end (a crash) counts until its last ledger line. */
export function researchHistory(ledgerPath: string, hash: string): ResearchHistory {
  let raw = "";
  try {
    raw = readFileSync(ledgerPath, "utf8");
  } catch {
    return { spentMs: 0, metricValues: [] };
  }
  const runs = new Map<string, { start: number; last: number }>();
  const metricValues: number[] = [];
  for (const line of raw.split("\n")) {
    let entry: { at?: number; kind?: string; runId?: string; hash?: string; value?: number };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry.at !== "number" || typeof entry.runId !== "string") continue;
    if (entry.kind === "run-start" && entry.hash === hash) runs.set(entry.runId, { start: entry.at, last: entry.at });
    const run = runs.get(entry.runId);
    if (!run) continue;
    run.last = Math.max(run.last, entry.at);
    if (entry.kind === "metric" && typeof entry.value === "number") metricValues.push(entry.value);
  }
  let spentMs = 0;
  for (const run of runs.values()) spentMs += run.last - run.start;
  return { spentMs, metricValues };
}

const slashes = (text: string): string => text.replace(/\\+/g, "/");

/** Held-out paths a bot's own tool calls named since `sinceMs`, read from one thread's event log. Only
 * `item.started` events count, so a brief or a plan that quotes a path is not a touch. */
export function heldOutMentions(ndjson: string, paths: readonly string[], sinceMs: number, instanceId?: string): string[] {
  const wanted = paths.map((path) => ({ path, needle: slashes(path).replace(/^\.\//, "") }));
  const found = new Set<string>();
  for (const line of ndjson.split("\n")) {
    if (!line.includes("item.started")) continue;
    let event: { type?: string; createdAt?: string; providerInstanceId?: string; summary?: string; input?: string };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "item.started" || Date.parse(event.createdAt ?? "") < sinceMs) continue;
    if (instanceId && event.providerInstanceId && event.providerInstanceId !== instanceId) continue;
    const text = slashes(`${event.summary ?? ""} ${event.input ?? ""}`);
    for (const { path, needle } of wanted) if (text.includes(needle)) found.add(path);
  }
  return [...found];
}
