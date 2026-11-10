import { execFile } from "node:child_process";

/** Snapshot a folder's write state with git porcelain lines, so a goal wave can report files changed outside
 * the set its tasks declared. Undefined means the audit is unavailable here: no git CLI, or not a work tree.
 * A file that was already modified before the wave keeps the same porcelain line, so re-editing it stays
 * unreported — this audit under-reports by design and never blocks. */
export async function gitStatusPorcelain(cwd: string): Promise<readonly string[] | undefined> {
  if (!(await gitAvailable())) return undefined;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("GIT_")) env[key] = value;
  const lines = await new Promise<string[] | undefined>((resolve) => {
    execFile("git", ["status", "--porcelain", "-z"], { cwd, env, windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      // "fatal: not a git repository" and every other failure keeps the audit silent for this folder.
      resolve(err ? undefined : stdout.split("\0").filter((field) => field !== ""));
    });
  });
  return lines;
}

let gitProbe: Promise<boolean> | null = null;
function gitAvailable(): Promise<boolean> {
  gitProbe ??= new Promise((resolve) => {
    execFile("git", ["--version"], { windowsHide: true, timeout: 5_000 }, (err) => resolve(!err));
  });
  return gitProbe;
}

const normalize = (path: string): string => path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

const declaredMatch = (changed: string, declared: readonly string[]): boolean =>
  declared.some((entry) => {
    const want = normalize(entry);
    return want === changed || changed.endsWith(`/${want}`) || want.endsWith(`/${changed}`);
  });

/** Paths whose porcelain line appeared, changed or vanished between the two snapshots, minus the declared writes. */
export function writesOutside(before: readonly string[], after: readonly string[], declared: readonly string[]): string[] {
  const lines = (snapshot: readonly string[]): { byPath: Map<string, string>; origins: Set<string> } => {
    const byPath = new Map<string, string>();
    const origins = new Set<string>();
    for (let index = 0; index < snapshot.length; index++) {
      const line = snapshot[index]!;
      // Porcelain v1: two status columns, a space, then the path; -z never quotes. A rename/copy record
      // carries the original path in the next NUL field, which is not a status line.
      const path = line.slice(3);
      if (path) byPath.set(normalize(path), line.slice(0, 2));
      if ("ARC".includes(line[0]!)) {
        const origin = snapshot[++index];
        if (origin) origins.add(normalize(origin.trim()));
      }
    }
    return { byPath, origins };
  };
  const beforeParsed = lines(before);
  const afterParsed = lines(after);
  const outside: string[] = [];
  for (const [path, status] of afterParsed.byPath) {
    if (beforeParsed.byPath.get(path) !== status && !declaredMatch(path, declared)) outside.push(path);
  }
  for (const path of beforeParsed.byPath.keys()) {
    if (!afterParsed.byPath.has(path) && !afterParsed.origins.has(path) && !declaredMatch(path, declared)) outside.push(path);
  }
  return outside;
}
