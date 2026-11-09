import type { LeadTaskBallot } from "./lead-goal.ts";

export const LEAD_MAX_WAVE_SIZE = 5;

function overlaps(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return b.some((x) => set.has(x));
}

export function leadTasksConflict(a: LeadTaskBallot, b: LeadTaskBallot): boolean {
  if (a.id === b.id) return true;
  if (overlaps(a.writes, b.writes)) return true;
  if (overlaps(a.writes, b.reads)) return true;
  if (overlaps(a.reads, b.writes)) return true;
  if (overlaps(a.locks, b.locks)) return true;
  return false;
}

export function canRunParallel(a: LeadTaskBallot, b: LeadTaskBallot): boolean {
  return !leadTasksConflict(a, b);
}

export type LeadWaveResult =
  | { ok: true; waves: LeadTaskBallot[][] }
  | { ok: false; error: string };

/** Waves by dependsOn (topological). Each wave fits maxWorkers and LEAD_MAX_WAVE_SIZE; a cycle or unknown id fails. */
export function leadWaves(tasks: readonly LeadTaskBallot[], maxWorkers: number): LeadWaveResult {
  const limit = Math.max(1, Math.min(Math.floor(maxWorkers) || 1, LEAD_MAX_WAVE_SIZE));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!byId.has(dep)) return { ok: false, error: `task ${t.id} depends on unknown task ${dep}` };
      if (dep === t.id) return { ok: false, error: `task ${t.id} depends on itself` };
    }
  }
  const remaining = new Set(tasks.map((t) => t.id));
  const done = new Set<string>();
  const waves: LeadTaskBallot[][] = [];
  while (remaining.size > 0) {
    const ready = tasks.filter((t) => remaining.has(t.id) && t.dependsOn.every((d) => done.has(d)));
    if (ready.length === 0) return { ok: false, error: "dependency cycle detected" };
    const wave = ready.slice(0, limit);
    waves.push(wave);
    for (const t of wave) {
      remaining.delete(t.id);
      done.add(t.id);
    }
  }
  return { ok: true, waves };
}

/** Pairs inside a wave that may not run in parallel; the caller must serialize them. */
export function leadConflictsInWave(wave: readonly LeadTaskBallot[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < wave.length; i++) {
    for (let j = i + 1; j < wave.length; j++) {
      if (leadTasksConflict(wave[i]!, wave[j]!)) out.push([wave[i]!.id, wave[j]!.id]);
    }
  }
  return out;
}
