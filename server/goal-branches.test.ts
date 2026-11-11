import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGoalBranches, GoalBranches } from "./goal-branches.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const roots: string[] = [];
const managers: GoalBranches[] = [];
const git = (cwd: string, ...args: string[]) => new Promise<string>((resolve, reject) => execFile("git", args, { cwd, encoding: "utf8", windowsHide: true }, (error, out) => error ? reject(error) : resolve(out.trim())));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "omb goal branches "));
  roots.push(root);
  const repo = join(root, "repo");
  const dataDir = join(root, "data");
  await mkdir(repo);
  await mkdir(dataDir);
  await git(repo, "init", "--quiet");
  await git(repo, "config", "core.autocrlf", "false");
  await git(repo, "config", "user.name", "Fixture");
  await git(repo, "config", "user.email", "fixture@localhost");
  await writeFile(join(repo, "a.txt"), "original a\n");
  await writeFile(join(repo, "b.txt"), "original b\n");
  await git(repo, "add", ".");
  await git(repo, "-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "fixture");
  const start = async (runId = "goal-1") => {
    const manager = await createGoalBranches({ repo, dataDir, groupId: "room-1", runId });
    managers.push(manager);
    return manager;
  };
  return { root, repo, dataDir, start };
}

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.releaseWorktrees().catch(() => undefined);
  for (const root of roots.splice(0)) await removeTempDir(root);
});

describe("goal branches in disposable Git repositories", () => {
  it("restores a retained integration branch, merges only the approved head, and makes the same decision idempotent", async () => {
    const f = await fixture();
    const manager = await f.start();
    const task = await manager.openTask({ taskId: "a", botId: "worker", writes: ["a.txt"] });
    await writeFile(join(task.cwd, "a.txt"), "checked result\n");
    await manager.commitTask(task.key); await manager.mergeTasks([task.key]);
    const head = manager.state().head;
    await expect(manager.decide("merge", manager.state().originalHead)).rejects.toThrow(/reload/);
    await manager.decide("keep", head);
    const restored = await GoalBranches.restore({ repo: f.repo, dataDir: f.dataDir, groupId: "room-1", runId: "goal-1" });
    managers.push(restored);
    expect(await readFile(join(restored.state().cwd, "a.txt"), "utf8")).toBe("checked result\n");
    expect((await restored.decide("merge", head)).decision).toBe("merged");
    const mergedHead = await git(f.repo, "rev-parse", "HEAD");
    expect(await readFile(join(f.repo, "a.txt"), "utf8")).toBe("checked result\n");
    expect((await restored.decide("merge", head)).decision).toBe("merged");
    expect(await git(f.repo, "rev-parse", "HEAD")).toBe(mergedHead);
  });

  it("refuses merge after source HEAD changes, and discards only its own branches and unfinished files", async () => {
    const f = await fixture();
    const manager = await f.start();
    const task = await manager.openTask({ taskId: "a", botId: "worker", writes: ["a.txt"] });
    await writeFile(join(task.cwd, "a.txt"), "goal change\n");
    await manager.commitTask(task.key); await manager.mergeTasks([task.key]);
    const head = manager.state().head;
    await git(f.repo, "-c", "commit.gpgSign=false", "commit", "--allow-empty", "--quiet", "-m", "human commit");
    const humanHead = await git(f.repo, "rev-parse", "HEAD");
    await expect(manager.decide("merge", head)).rejects.toThrow(/HEAD changed/);
    await writeFile(join(task.cwd, "unfinished.txt"), "unfinished\n");
    expect((await manager.decide("discard", head)).decision).toBe("discarded");
    expect(existsSync(task.cwd)).toBe(false);
    expect(await git(f.repo, "rev-parse", "HEAD")).toBe(humanHead);
    expect(await readFile(join(f.repo, "a.txt"), "utf8")).toBe("original a\n");
    expect(await git(f.repo, "show-ref", "--verify", `refs/heads/${manager.state().branch}`).then(() => true, () => false)).toBe(false);
  });

  it("copies only ignored local files and rejects symlinks and tampered ledger paths", async () => {
    const f = await fixture();
    await writeFile(join(f.repo, ".git", "info", "exclude"), ".env.local\n");
    await writeFile(join(f.repo, ".env.local"), "fixture=yes\n");
    const manager = await f.start();
    const task = await manager.openTask({ taskId: "copy", botId: "worker", writes: [] });
    await manager.copyFiles(task.cwd, [".env.local"]);
    expect(await readFile(join(task.cwd, ".env.local"), "utf8")).toBe("fixture=yes\n");
    await expect(manager.copyFiles(task.cwd, ["a.txt"])).rejects.toThrow(/Only ignored/);
    await expect(manager.copyFiles(task.cwd, [".git/config"])).rejects.toThrow(/relative paths/);
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await symlink(outside, join(f.repo, "local-link"), process.platform === "win32" ? "junction" : "dir");
    await expect(manager.copyFiles(task.cwd, ["local-link"])).rejects.toThrow(/symlinks/);
    const saved = JSON.parse(await readFile(join(manager.root, "branches.json"), "utf8"));
    saved.tasks[0].cwd = f.repo;
    await writeFile(join(manager.root, "branches.json"), JSON.stringify(saved));
    await expect(GoalBranches.restore({ repo: f.repo, dataDir: f.dataDir, groupId: "room-1", runId: "goal-1" })).rejects.toThrow(/Invalid task/);
  });

  it("refuses every pending decision when the actual integration ref changed outside the server", async () => {
    const f = await fixture();
    const manager = await f.start();
    const head = manager.state().head;
    await git(manager.state().cwd, "-c", "commit.gpgSign=false", "commit", "--allow-empty", "--quiet", "-m", "external change");
    for (const action of ["merge", "keep", "discard"] as const) await expect(manager.decide(action, head)).rejects.toThrow(/reload/);
    expect(existsSync(manager.state().cwd)).toBe(true);
    expect(await git(f.repo, "rev-parse", "HEAD")).toBe(head);
  });

  it("isolates parallel tasks, merges them in order, and preserves the original folder, branch and index", async () => {
    const f = await fixture();
    const head = await git(f.repo, "rev-parse", "HEAD");
    const branch = await git(f.repo, "symbolic-ref", "HEAD");
    const index = await readFile(join(f.repo, ".git", "index"));
    const manager = await f.start();
    const [a, b] = await Promise.all([
      manager.openTask({ taskId: "a", botId: "worker-a", writes: ["a.txt"] }),
      manager.openTask({ taskId: "b", botId: "worker-b", writes: ["b.txt"] }),
    ]);
    expect(a.base).toBe(b.base);
    await writeFile(join(a.cwd, "a.txt"), "from worker a\n");
    expect(await readFile(join(b.cwd, "a.txt"), "utf8")).toBe("original a\n");
    await writeFile(join(b.cwd, "b.txt"), "from worker b\n");
    expect((await manager.commitTask(a.key)).outsideWrites).toEqual([]);
    expect((await manager.commitTask(b.key)).outsideWrites).toEqual([]);
    expect(await manager.mergeTasks([a.key, b.key])).toEqual([{ key: a.key, status: "merged" }, { key: b.key, status: "merged" }]);
    const merged = manager.state();
    expect(await readFile(join(merged.cwd, "a.txt"), "utf8")).toBe("from worker a\n");
    expect(await readFile(join(merged.cwd, "b.txt"), "utf8")).toBe("from worker b\n");
    expect((await git(merged.cwd, "rev-list", "--parents", "-n", "1", "HEAD")).split(" ")).toHaveLength(3);
    expect(await manager.taskDiff(a.key)).toContain("+from worker a");
    expect(await manager.taskDiff(a.key)).not.toContain("worker b");
    const next = await manager.openTask({ taskId: "a", botId: "worker-a", writes: ["a.txt"] });
    expect(next.key).not.toBe(a.key);
    expect(next.base).toBe(merged.head);
    expect(await readFile(join(next.cwd, "b.txt"), "utf8")).toBe("from worker b\n");
    expect(await manager.releaseWorktrees()).toEqual({ retained: [] });
    expect(existsSync(merged.cwd)).toBe(false);
    expect(await git(f.repo, "rev-parse", merged.branch)).toBe(merged.head);
    expect(await git(f.repo, "rev-parse", "HEAD")).toBe(head);
    expect(await git(f.repo, "symbolic-ref", "HEAD")).toBe(branch);
    expect(await readFile(join(f.repo, ".git", "index"))).toEqual(index);
    expect(await git(f.repo, "status", "--porcelain")).toBe("");
    expect(await readFile(join(f.repo, "a.txt"), "utf8")).toBe("original a\n");
    expect(JSON.parse(await readFile(join(manager.root, "branches.json"), "utf8"))).toMatchObject({ released: true, originalHead: head });
  });

  it("aborts conflicts cleanly, keeps the conflicting task's diff, and stops before the next merge", async () => {
    const f = await fixture();
    const manager = await f.start();
    const a = await manager.openTask({ taskId: "a", botId: "one", writes: ["a.txt"] });
    const b = await manager.openTask({ taskId: "b", botId: "two", writes: ["a.txt"] });
    const c = await manager.openTask({ taskId: "c", botId: "three", writes: ["b.txt"] });
    await writeFile(join(a.cwd, "a.txt"), "first change\n");
    await writeFile(join(b.cwd, "a.txt"), "second change\n");
    await writeFile(join(c.cwd, "b.txt"), "third change\n");
    for (const task of [a, b, c]) await manager.commitTask(task.key);
    expect(await manager.mergeTasks([a.key, b.key, c.key])).toEqual([{ key: a.key, status: "merged" }, { key: b.key, status: "conflict", files: ["a.txt"] }]);
    const state = manager.state();
    expect(state.tasks[1]).toMatchObject({ phase: "conflict", conflicts: ["a.txt"] });
    expect(state.tasks[2]!.phase).toBe("committed");
    expect(await git(state.cwd, "status", "--porcelain")).toBe("");
    expect(await git(state.cwd, "rev-parse", "HEAD")).toBe(state.head);
    expect(await git(state.cwd, "rev-parse", "--verify", "MERGE_HEAD").then(() => true, () => false)).toBe(false);
    expect(await manager.taskDiff(b.key)).toContain("+second change");
    expect(await readFile(join(state.cwd, "a.txt"), "utf8")).toBe("first change\n");
    expect(await readFile(join(state.cwd, "b.txt"), "utf8")).toBe("original b\n");
    expect(await git(f.repo, "status", "--porcelain")).toBe("");
  });

  it("records exact per-task changes, undeclared paths and both sides of a rename", async () => {
    const f = await fixture();
    const manager = await f.start();
    const task = await manager.openTask({ taskId: "move", botId: "worker", writes: ["./src/", "a.txt"] });
    await mkdir(join(task.cwd, "src"));
    await mkdir(join(task.cwd, "other", "src"), { recursive: true });
    await writeFile(join(task.cwd, "src", "inside.txt"), "inside\n");
    await writeFile(join(task.cwd, "other", "src", "outside.txt"), "outside\n");
    await rename(join(task.cwd, "a.txt"), join(task.cwd, "renamed.txt"));
    const committed = await manager.commitTask(task.key);
    expect(committed.changed.sort()).toEqual(["a.txt", "other/src/outside.txt", "renamed.txt", "src/inside.txt"]);
    expect(committed.outsideWrites.sort()).toEqual(["other/src/outside.txt", "renamed.txt"]);
    expect(await git(f.repo, "status", "--porcelain")).toBe("");
  });

  it("does not create an empty commit and retains dirty worktrees instead of forcing their deletion", async () => {
    const f = await fixture();
    const manager = await f.start();
    const task = await manager.openTask({ taskId: "empty", botId: "worker", writes: [] });
    const committed = await manager.commitTask(task.key);
    expect(committed).toMatchObject({ phase: "empty", head: task.base, changed: [] });
    expect(await manager.mergeTasks([task.key])).toEqual([{ key: task.key, status: "empty" }]);
    expect(manager.state().head).toBe(task.base);
    await writeFile(join(task.cwd, "keep.txt"), "unfinished\n");
    await writeFile(join(f.repo, "human.txt"), "human edit during goal\n");
    expect(await manager.releaseWorktrees()).toEqual({ retained: [task.cwd] });
    expect(await readFile(join(task.cwd, "keep.txt"), "utf8")).toBe("unfinished\n");
    expect(await readFile(join(f.repo, "human.txt"), "utf8")).toBe("human edit during goal\n");
  });

  it("refuses a dirty source, non-root room folders, unsafe storage, duplicate runs and invalid writes", async () => {
    const f = await fixture();
    const input = { repo: f.repo, dataDir: f.dataDir, groupId: "room-1", runId: "goal-1" };
    await writeFile(join(f.repo, "a.txt"), "dirty\n");
    await expect(createGoalBranches(input)).rejects.toThrow(/Commit or stash/);
    await git(f.repo, "restore", "a.txt");
    await mkdir(join(f.repo, "sub"));
    await expect(createGoalBranches({ ...input, repo: join(f.repo, "sub") })).rejects.toThrow(/repository root/);
    await expect(createGoalBranches({ ...input, dataDir: f.repo })).rejects.toThrow(/outside/);
    expect(existsSync(join(f.repo, "worktrees"))).toBe(false);
    const manager = await f.start();
    await expect(f.start()).rejects.toThrow();
    for (const path of ["../outside", "./", "/absolute", "C:\\outside", "src/../outside"]) {
      await expect(manager.openTask({ taskId: "bad", botId: "worker", writes: [path] })).rejects.toThrow(/relative paths/);
    }
    expect(manager.state().tasks).toEqual([]);
  });

  it("keeps ignored files and refuses cleanup after a worktree switches away from its owned branch", async () => {
    const f = await fixture();
    await writeFile(join(f.repo, ".git", "info", "exclude"), "private/\n");
    const manager = await f.start();
    const task = await manager.openTask({ taskId: "private", botId: "worker", writes: [] });
    await mkdir(join(task.cwd, "private"));
    await writeFile(join(task.cwd, "private", "notes.txt"), "keep ignored data\n");
    expect(await manager.releaseWorktrees()).toEqual({ retained: [task.cwd] });
    expect(await readFile(join(task.cwd, "private", "notes.txt"), "utf8")).toBe("keep ignored data\n");
    await git(task.cwd, "checkout", "--detach", "--quiet");
    await expect(manager.releaseWorktrees()).rejects.toThrow(/owned branch/);
    expect(existsSync(task.cwd)).toBe(true);
  });

  it("uses the owned paths and server identity while ignoring inherited Git routing variables and repository hooks", async () => {
    const f = await fixture();
    const hooks = join(f.repo, ".git", "hooks");
    const marker = join(f.root, "hook-ran");
    const hook = `#!/bin/sh\necho ran > '${marker.replace(/\\/g, "/")}'\n`;
    for (const name of ["post-checkout", "pre-commit", "post-commit", "post-merge"]) {
      await writeFile(join(hooks, name), hook);
      await chmod(join(hooks, name), 0o755);
    }
    const manager = await f.start();
    const old = { GIT_INDEX_FILE: process.env.GIT_INDEX_FILE, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
    try {
      process.env.GIT_INDEX_FILE = join(f.root, "foreign-index");
      process.env.GIT_WORK_TREE = f.root;
      const task = await manager.openTask({ taskId: "../task:with?invalid-ref", botId: "worker", writes: ["a.txt"] });
      await writeFile(join(task.cwd, "a.txt"), "owned change\n");
      await manager.commitTask(task.key);
      await manager.mergeTasks([task.key]);
    } finally {
      for (const [name, value] of Object.entries(old)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(f.root, "foreign-index"))).toBe(false);
    expect(await git(manager.state().cwd, "log", "-1", "--format=%an <%ae>")).toBe("OpenMausBot <openmausbot@localhost>");
    expect(await git(f.repo, "status", "--porcelain")).toBe("");
  });
});
