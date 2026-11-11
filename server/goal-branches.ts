import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { z } from "zod";
import type { GoalBranchCard } from "../shared/goal-branches.ts";
import { augmentedPath } from "./env-path.ts";
import { redactSecretsInText } from "../shared/redact.ts";

type TaskPhase = "opening" | "working" | "committed" | "empty" | "merged" | "conflict" | "failed" | "superseded";

export interface GoalBranchTask {
  key: string;
  taskId: string;
  botId: string;
  branch: string;
  cwd: string;
  base: string;
  head?: string;
  writes: string[];
  changed: string[];
  outsideWrites: string[];
  conflicts: string[];
  phase: TaskPhase;
  released?: true;
}

export interface GoalBranchState {
  version: 1;
  groupId: string;
  runId: string;
  repo: string;
  originalBranch: string | null;
  originalHead: string;
  branch: string;
  cwd: string;
  head: string;
  decision?: GoalBranchCard["decision"];
  released?: true;
  tasks: GoalBranchTask[];
}

export type GoalBranchMerge = { key: string; status: "merged" | "empty" } | { key: string; status: "conflict"; files: string[] };

const identity = ["-c", "user.name=OpenMausBot", "-c", "user.email=openmausbot@localhost", "-c", "commit.gpgSign=false"];
const flags = ["--no-optional-locks", "-c", "core.hooksPath=", "-c", "rerere.enabled=false", "-c", "merge.autoStash=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false"];
const keyOf = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root: string, path: string) => {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && !isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
};

function git(cwd: string, args: readonly string[]): Promise<{ code: number; out: string; error: string }> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")));
  env.PATH = augmentedPath();
  return new Promise((done, reject) => {
    execFile("git", [...flags, ...args], { cwd, env, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, out, stderr) => {
      if (error && (typeof error.code !== "number" || error.killed)) { reject(error); return; }
      done({ code: typeof error?.code === "number" ? error.code : 0, out, error: stderr });
    });
  });
}

async function checkedGit(cwd: string, args: readonly string[]): Promise<string> {
  const result = await git(cwd, args);
  if (result.code !== 0) throw new Error(`Goal branch git ${args[0]} failed: ${result.error.trim().slice(-1000)}`);
  return result.out;
}

export function branchPaths(values: readonly string[]): string[] {
  return values.map((value) => {
    const path = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!path || path === "." || /^\/|^[A-Za-z]:/.test(path) || path.split("/").some((part) => part === ".." || part === "." || part.toLowerCase() === ".git" || !part) || path.includes("\0")) {
      throw new Error("Goal branch writes must name relative paths inside the repository");
    }
    return path;
  });
}

export interface GoalBranchesInput { repo: string; dataDir: string; groupId: string; runId: string }

export function createGoalBranches(input: GoalBranchesInput): Promise<GoalBranches> { return GoalBranches.create(input); }

export async function isGoalGitRepo(folder: string): Promise<boolean> {
  try { return (await git(folder, ["rev-parse", "--is-inside-work-tree"])).out.trim() === "true"; } catch { return false; }
}

const oid = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
const taskSchema = z.object({ key: z.string(), taskId: z.string(), botId: z.string(), branch: z.string(), cwd: z.string(), base: oid, head: oid.optional(), writes: z.array(z.string()), changed: z.array(z.string()), outsideWrites: z.array(z.string()), conflicts: z.array(z.string()), phase: z.enum(["opening", "working", "committed", "empty", "merged", "conflict", "failed", "superseded"]), released: z.literal(true).optional() });
const stateSchema = z.object({ version: z.literal(1), groupId: z.string(), runId: z.string(), repo: z.string(), originalBranch: z.string().nullable(), originalHead: oid, branch: z.string(), cwd: z.string(), head: oid, released: z.literal(true).optional(), decision: z.enum(["pending", "kept", "merged", "discarded"]).optional(), tasks: z.array(taskSchema) });

export class GoalBranches {
  readonly root: string;
  private readonly current: GoalBranchState;
  private pending: Promise<unknown> = Promise.resolve();

  private constructor(root: string, state: GoalBranchState) {
    this.root = root;
    this.current = state;
  }

  static async create(input: GoalBranchesInput): Promise<GoalBranches> {
    if (!input.groupId || !input.runId) throw new Error("Goal branches need a group and run id");
    const repo = await realpath(input.repo);
    const top = await realpath((await checkedGit(repo, ["rev-parse", "--show-toplevel"])).trim());
    if (!samePath(repo, top)) throw new Error("Goal branches require the room folder to be the repository root");
    if ((await checkedGit(repo, ["status", "--porcelain", "--untracked-files=all"])).trim()) throw new Error("Commit or stash the room's changes before starting isolated goal branches");
    const originalHead = (await checkedGit(repo, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
    if ((await checkedGit(repo, ["ls-files", "--stage"])).split("\n").some((line) => line.startsWith("160000 "))) throw new Error("Isolated goal branches do not support submodules");
    const attributes = await git(repo, ["grep", "-l", "filter=lfs", "HEAD", "--", "**/.gitattributes", ".gitattributes"]);
    if (attributes.code === 0 && attributes.out.trim()) throw new Error("Isolated goal branches do not support Git LFS");
    const symbolic = await git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const storage = resolve(await realpath(input.dataDir), "worktrees");
    if (samePath(storage, repo) || inside(repo, storage) || inside(storage, repo)) throw new Error("Goal worktrees must live outside the room repository");
    await mkdir(storage, { recursive: true });
    const storageRoot = await realpath(storage);
    if (samePath(storageRoot, repo) || inside(repo, storageRoot) || inside(storageRoot, repo)) throw new Error("Goal worktrees must live outside the room repository");
    const groupRoot = join(storageRoot, keyOf(input.groupId));
    await mkdir(groupRoot, { recursive: true });
    if (!inside(storageRoot, await realpath(groupRoot))) throw new Error("Goal worktree storage escaped its root");
    const root = join(groupRoot, keyOf(input.runId));
    await mkdir(root);
    await mkdir(join(root, "hooks"));
    const cwd = join(root, "integration");
    // Git refs cannot be both `omb/RUN` and the directory of `omb/RUN/task`.
    const branch = `omb/${keyOf(input.groupId)}/${keyOf(input.runId)}/integration`;
    const state: GoalBranchState = { version: 1, groupId: input.groupId, runId: input.runId, repo, originalBranch: symbolic.code === 0 ? symbolic.out.trim() : null, originalHead, branch, cwd, head: originalHead, tasks: [] };
    const manager = new GoalBranches(root, state);
    manager.save();
    await checkedGit(repo, ["-c", `core.hooksPath=${join(root, "hooks")}`, "worktree", "add", "-b", branch, "--", cwd, originalHead]);
    return manager;
  }

  state(): GoalBranchState { return structuredClone(this.current); }

  checkIntegration(): Promise<void> { return this.serial(() => this.integrationReady()); }

  card(): GoalBranchCard {
    const state = this.current;
    const paths = (values: string[]) => values.slice(0, 100).map(redactSecretsInText);
    return { runId: state.runId, branch: state.branch, head: state.head, originalBranch: state.originalBranch ? redactSecretsInText(state.originalBranch) : null, decision: state.decision ?? "pending", tasks: state.tasks.slice(-40).map(({ key, taskId, botId, branch, phase, changed, outsideWrites, conflicts }) => ({ key, taskId: redactSecretsInText(taskId), botId, branch, phase, changed: paths(changed), outsideWrites: paths(outsideWrites), conflicts: paths(conflicts) })) };
  }

  static async restore(input: GoalBranchesInput, reopen = true): Promise<GoalBranches> {
    const storage = await realpath(resolve(await realpath(input.dataDir), "worktrees"));
    const root = join(storage, keyOf(input.groupId), keyOf(input.runId));
    const canonical = await realpath(root);
    if (!samePath(root, canonical) || !inside(storage, canonical)) throw new Error("Invalid goal branch storage");
    const saved = stateSchema.parse(JSON.parse(await readFile(join(root, "branches.json"), "utf8")));
    const prefix = `omb/${keyOf(input.groupId)}/${keyOf(input.runId)}`;
    if (saved.groupId !== input.groupId || saved.runId !== input.runId || !samePath(saved.repo, await realpath(input.repo)) || saved.branch !== `${prefix}/integration` || !samePath(saved.cwd, join(root, "integration"))) throw new Error("Goal branch ledger does not match this room and run");
    for (const [i, task] of saved.tasks.entries()) {
      const key = `${i + 1}-${keyOf(task.taskId)}`;
      if (task.key !== key || task.branch !== `${prefix}/tasks/${key}` || !samePath(task.cwd, join(root, key))) throw new Error("Invalid task in goal branch ledger");
      branchPaths(task.writes);
    }
    const manager = new GoalBranches(root, saved);
    if (reopen && (saved.decision === "merged" || saved.decision === "discarded")) throw new Error("This goal branch has already been merged or discarded");
    if (reopen && saved.released) {
      if ((await checkedGit(saved.repo, ["rev-parse", saved.branch])).trim() !== saved.head) throw new Error("Retained goal branch changed since it was saved");
      await manager.checkedGit(saved.repo, ["worktree", "add", "--", saved.cwd, saved.branch]);
      delete saved.released;
      manager.save();
    }
    if (reopen) await manager.integrationReady();
    return manager;
  }

  async copyFiles(cwd: string, paths: readonly string[]): Promise<void> {
    const entries = branchPaths(paths);
    if (!inside(await realpath(this.root), await realpath(cwd))) throw new Error("Copy destination is not a goal worktree");
    const checkTree = async (path: string): Promise<void> => {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || relative(this.current.repo, path).replace(/\\/g, "/").split("/").some((part) => part.toLowerCase() === ".git") || !inside(this.current.repo, await realpath(path))) throw new Error("Cannot copy symlinks, Git metadata or files outside the room repository");
      if (stat.isDirectory()) {
        const { readdir } = await import("node:fs/promises");
        for (const name of await readdir(path)) await checkTree(join(path, name));
      }
    };
    for (const path of entries) {
      await checkTree(join(this.current.repo, path));
      if ((await this.git(this.current.repo, ["check-ignore", "--quiet", "--", path])).code !== 0) throw new Error(`Only ignored local files may be copied: ${path}`);
      const destination = join(cwd, path);
      await mkdir(resolve(destination, ".."), { recursive: true });
      const parent = await realpath(resolve(destination, ".."));
      if (!samePath(parent, cwd) && !inside(cwd, parent)) throw new Error("Copy destination escaped the goal worktree");
      await cp(join(this.current.repo, path), destination, { recursive: true, force: false, errorOnExist: true });
    }
  }

  async diffFile(key: string): Promise<string> {
    const file = join(this.root, `${this.task(key).key}.patch`);
    await writeFile(file, await this.taskDiff(key), { mode: 0o600 });
    return file;
  }

  supersede(key: string): void {
    const task = this.task(key);
    if (!["conflict", "committed", "empty"].includes(task.phase)) throw new Error("Only an unmerged task can be superseded");
    task.phase = "superseded";
    this.save();
  }

  private save(): void { writeFileAtomic(join(this.root, "branches.json"), JSON.stringify(this.current), { mode: 0o600 }); }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.then(work);
    this.pending = next.catch(() => undefined);
    return next;
  }

  private git(cwd: string, args: readonly string[]) { return git(cwd, ["-c", `core.hooksPath=${join(this.root, "hooks")}`, ...args]); }

  private async checkedGit(cwd: string, args: readonly string[]): Promise<string> {
    const result = await this.git(cwd, args);
    if (result.code !== 0) throw new Error(`Goal branch git ${args[0]} failed: ${result.error.trim().slice(-1000)}`);
    return result.out;
  }

  private task(key: string): GoalBranchTask {
    const task = this.current.tasks.find((entry) => entry.key === key);
    if (!task) throw new Error("Unknown goal branch task");
    return task;
  }

  private async owned(cwd: string, branch: string): Promise<void> {
    const actual = await realpath(cwd);
    if (!inside(await realpath(this.root), actual)) throw new Error("Goal worktree escaped its owned run directory");
    const top = await realpath((await this.checkedGit(actual, ["rev-parse", "--show-toplevel"])).trim());
    const ref = await this.git(actual, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (!samePath(top, actual) || ref.code !== 0 || ref.out.trim() !== branch) throw new Error("Goal worktree no longer checks out its owned branch");
    const common = async (cwd: string) => realpath(resolve(cwd, (await this.checkedGit(cwd, ["rev-parse", "--git-common-dir"])).trim()));
    if (!samePath(await common(actual), await common(this.current.repo))) throw new Error("Goal worktree belongs to a different repository");
  }

  private async integrationReady(): Promise<void> {
    if (this.current.released) throw new Error("Goal integration worktree has been released");
    await this.owned(this.current.cwd, this.current.branch);
    if ((await this.checkedGit(this.current.cwd, ["rev-parse", "HEAD"])).trim() !== this.current.head) throw new Error("Goal integration HEAD changed outside the branch manager");
    if ((await this.checkedGit(this.current.cwd, ["status", "--porcelain", "--untracked-files=all"])).trim()) throw new Error("Goal integration worktree has uncommitted changes");
  }

  openTask(input: { taskId: string; botId: string; writes: readonly string[] }): Promise<GoalBranchTask> {
    return this.serial(async () => {
      const writes = branchPaths(input.writes);
      if (!input.taskId || !input.botId) throw new Error("Goal branch tasks need a task and bot id");
      await this.integrationReady();
      const key = `${this.current.tasks.length + 1}-${keyOf(input.taskId)}`;
      const branch = this.current.branch.replace(/\/integration$/, `/tasks/${key}`);
      const task: GoalBranchTask = { key, taskId: input.taskId, botId: input.botId, branch, cwd: join(this.root, key), base: this.current.head, writes, changed: [], outsideWrites: [], conflicts: [], phase: "opening" };
      this.current.tasks.push(task);
      this.save();
      try {
        await this.checkedGit(this.current.repo, ["worktree", "add", "-b", branch, "--", task.cwd, task.base]);
        task.phase = "working";
      } catch (error) {
        task.phase = "failed";
        throw error;
      } finally { this.save(); }
      return structuredClone(task);
    });
  }

  commitTask(key: string): Promise<GoalBranchTask> {
    return this.serial(async () => {
      const task = this.task(key);
      if (task.phase !== "working" || task.released) throw new Error("Only a working task can be committed");
      await this.owned(task.cwd, task.branch);
      if ((await this.git(task.cwd, ["merge-base", "--is-ancestor", task.base, "HEAD"])).code !== 0) throw new Error("Worker branch no longer descends from its task base");
      await this.checkedGit(task.cwd, ["add", "--all", "--", "."]);
      const staged = await this.git(task.cwd, ["diff", "--cached", "--quiet"]);
      if (staged.code > 1) throw new Error("Cannot inspect the Worker branch index");
      if (staged.code === 1) await this.checkedGit(task.cwd, [...identity, "commit", "--quiet", "-m", `Goal task ${task.key}`]);
      task.head = (await this.checkedGit(task.cwd, ["rev-parse", "HEAD"])).trim();
      task.changed = (await this.checkedGit(task.cwd, ["diff", "--name-only", "--no-renames", "-z", task.base, task.head, "--"])).split("\0").filter(Boolean);
      task.outsideWrites = task.changed.filter((file) => !task.writes.some((path) => file === path || file.startsWith(`${path}/`)));
      task.phase = task.changed.length ? "committed" : "empty";
      this.save();
      return structuredClone(task);
    });
  }

  mergeTasks(keys: readonly string[]): Promise<GoalBranchMerge[]> {
    return this.serial(async () => {
      const results: GoalBranchMerge[] = [];
      for (const key of keys) {
        const task = this.task(key);
        if (!["committed", "empty", "conflict"].includes(task.phase) || !task.head) throw new Error("Commit each Worker task before merging it");
        await this.integrationReady();
        if (task.phase === "empty") {
          task.phase = "merged";
          results.push({ key, status: "empty" });
          this.save();
          continue;
        }
        const merged = await this.git(this.current.cwd, [...identity, "merge", "--no-ff", "--no-edit", task.head]);
        if (merged.code === 0) {
          this.current.head = (await this.checkedGit(this.current.cwd, ["rev-parse", "HEAD"])).trim();
          task.phase = "merged";
          task.conflicts = [];
          results.push({ key, status: "merged" });
          this.save();
          continue;
        }
        const files = (await this.checkedGit(this.current.cwd, ["diff", "--name-only", "--diff-filter=U", "-z"])).split("\0").filter(Boolean);
        if ((await this.git(this.current.cwd, ["rev-parse", "--quiet", "--verify", "MERGE_HEAD"])).code === 0) await this.checkedGit(this.current.cwd, ["merge", "--abort"]);
        await this.integrationReady();
        if (!files.length) throw new Error(`Goal task merge failed: ${merged.error.trim().slice(-1000)}`);
        task.phase = "conflict";
        task.conflicts = files;
        this.save();
        results.push({ key, status: "conflict", files: [...files] });
        break;
      }
      return results;
    });
  }

  taskDiff(key: string): Promise<string> {
    return this.serial(async () => {
      const task = this.task(key);
      if (!task.head) throw new Error("Commit a Worker task before requesting its diff");
      return this.checkedGit(this.current.repo, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", task.base, task.head, "--"]);
    });
  }

  decide(action: "merge" | "keep" | "discard", head: string): Promise<GoalBranchCard> {
    return this.serial(async () => {
      if (this.current.head !== head) throw new Error("Goal branch changed; reload the card before deciding");
      const desired = action === "merge" ? "merged" : action === "keep" ? "kept" : "discarded";
      if (this.current.decision === desired) return this.card();
      if (this.current.decision === "merged" || this.current.decision === "discarded") throw new Error("This goal branch has already been decided");
      if ((await this.checkedGit(this.current.repo, ["rev-parse", "--verify", `refs/heads/${this.current.branch}`])).trim() !== head) throw new Error("Goal branch changed; reload the card before deciding");
      if (action === "merge") {
        await this.integrationReady();
        if (this.current.tasks.some((task) => task.phase === "conflict" || task.phase === "committed")) throw new Error("Goal still has unmerged Worker changes");
        const { repo, originalHead, originalBranch } = this.current;
        const branch = await this.git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
        if (!originalBranch || branch.code !== 0 || branch.out.trim() !== originalBranch || (await this.checkedGit(repo, ["rev-parse", "HEAD"])).trim() !== originalHead) throw new Error("The original branch or HEAD changed; keep the goal branch and merge it manually");
        if ((await this.checkedGit(repo, ["status", "--porcelain", "--untracked-files=all"])).trim()) throw new Error("Commit or stash your changes before merging this goal");
        const merged = await this.git(repo, [...identity, "merge", "--no-ff", "--no-edit", this.current.head]);
        if (merged.code !== 0) {
          if ((await this.git(repo, ["rev-parse", "--quiet", "--verify", "MERGE_HEAD"])).code === 0) await this.checkedGit(repo, ["merge", "--abort"]);
          throw new Error("The goal could not merge cleanly; its branch has been kept");
        }
      }
      if (action === "discard") {
        await this.removeOwned(true);
        for (const entry of [...this.current.tasks, this.current]) {
          const ref = await this.git(this.current.repo, ["rev-parse", "--verify", `refs/heads/${entry.branch}`]);
          if (ref.code === 0) await this.checkedGit(this.current.repo, ["update-ref", "-d", `refs/heads/${entry.branch}`, ref.out.trim()]);
        }
      } else await this.removeOwned(false);
      this.current.decision = desired;
      this.save();
      return this.card();
    });
  }

  private async removeOwned(force: boolean): Promise<{ retained: string[] }> {
    const retained: string[] = [];
    for (const entry of [...this.current.tasks, this.current]) {
      if (entry.released) continue;
      await this.owned(entry.cwd, entry.branch);
      if (!force && (await this.checkedGit(entry.cwd, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored=matching"])).length) { retained.push(entry.cwd); continue; }
      const removed = await this.git(this.current.repo, ["worktree", "remove", ...(force ? ["--force"] : []), "--", entry.cwd]);
      if (removed.code !== 0) {
        if (force) throw new Error(`Cannot remove owned goal worktree: ${removed.error.trim().slice(-500)}`);
        retained.push(entry.cwd); continue;
      }
      entry.released = true;
      this.save();
    }
    return { retained };
  }

  releaseWorktrees(): Promise<{ retained: string[] }> {
    return this.serial(() => this.removeOwned(false));
  }
}
