import { execFile, spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { augmentedPath } from "./env-path.ts";

/** Each changed path's git status plus, for a file still on disk, its content hash; a path a rename moved
 * away from maps to RENAMED_FROM. Ignored files are not in it. */
export type WritesSnapshot = ReadonlyMap<string, string>;

const RENAMED_FROM = "renamed-from";
/** Past this many changed paths (an unignored dependency or data folder) the snapshot keeps statuses only. */
const MAX_HASHED_FILES = 2_000;

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("GIT_")) env[key] = value;
  env.PATH = augmentedPath();
  return env;
}

function git(args: readonly string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, env: gitEnv(), windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? undefined : stdout);
    });
  });
}

function hashObjects(paths: readonly string[], cwd: string): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    const child = spawn("git", ["hash-object", "--stdin-paths"], { cwd, env: gitEnv(), windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      const hashes = out.split("\n").filter(Boolean);
      resolve(code === 0 && hashes.length === paths.length ? hashes : undefined);
    });
    child.stdin.end(paths.map((path) => `${path}\n`).join(""));
  });
}

let gitProbe: Promise<boolean> | null = null;
function gitAvailable(): Promise<boolean> {
  gitProbe ??= git(["--version"], process.cwd()).then((out) => out !== undefined);
  return gitProbe;
}

const normalize = (path: string): string => path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

/** A folder's write state for the writes audit. Undefined means the audit is unavailable here: no git CLI, or
 * not a work tree. Hashing the dirty files' contents is what lets a second edit to an already-modified file
 * show up; a file whose contents cannot be hashed falls back to its status alone. */
export async function writesSnapshot(cwd: string): Promise<WritesSnapshot | undefined> {
  if (!(await gitAvailable())) return undefined;
  const top = (await git(["rev-parse", "--show-toplevel"], cwd))?.trim();
  const porcelain = top ? await git(["status", "--porcelain", "-z", "--untracked-files=all"], top) : undefined;
  if (!top || porcelain === undefined) return undefined;
  const fields = porcelain.split("\0").filter((field) => field !== "");
  const state = new Map<string, string>();
  for (let index = 0; index < fields.length; index++) {
    const line = fields[index]!;
    // Porcelain v1: two status columns, a space, then the path; -z never quotes. A rename/copy record
    // carries the original path in the next NUL field, which is not a status line.
    const path = line.slice(3);
    if (path) state.set(normalize(path), line.slice(0, 2));
    if (/[RC]/.test(line.slice(0, 2))) {
      const origin = fields[++index];
      if (origin) state.set(normalize(origin), RENAMED_FROM);
    }
  }
  const files = state.size > MAX_HASHED_FILES ? [] : [...state.entries()]
    .filter(([path, status]) => status !== RENAMED_FROM && !path.includes("\n") && isFile(join(top, path)))
    .map(([path]) => path);
  const hashes = files.length ? await hashObjects(files, top) : [];
  files.forEach((path, index) => {
    const hash = hashes?.[index];
    if (hash) state.set(path, `${state.get(path)} ${hash}`);
  });
  return state;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Whether a path is one of the declared writes or inside a declared folder; either side may be the shorter tail of the
 * other. */
export function pathDeclared(path: string, declared: readonly string[]): boolean {
  const changed = normalize(path);
  return declared.some((entry) => {
    const want = normalize(entry);
    if (!want) return false;
    return want === changed || changed.endsWith(`/${want}`) || want.endsWith(`/${changed}`) ||
      changed.startsWith(`${want}/`) || changed.includes(`/${want}/`);
  });
}

/** Paths whose state appeared, changed or vanished between the two snapshots, minus the declared writes. */
export function writesOutside(before: WritesSnapshot, after: WritesSnapshot, declared: readonly string[]): string[] {
  const outside: string[] = [];
  for (const [path, state] of after) {
    if (state !== RENAMED_FROM && before.get(path) !== state && !pathDeclared(path, declared)) outside.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path) && before.get(path) !== RENAMED_FROM && !pathDeclared(path, declared)) outside.push(path);
  }
  return outside;
}
