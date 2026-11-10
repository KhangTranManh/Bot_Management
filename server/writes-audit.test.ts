import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writesOutside, writesSnapshot, type WritesSnapshot } from "./writes-audit.ts";

const snap = (entries: Record<string, string>): WritesSnapshot => new Map(Object.entries(entries));

describe("writesOutside", () => {
  it("reports files that appeared, changed state, or vanished", () => {
    const before = snap({ "kept.ts": " M h1", "edited.ts": " M h2" });
    const after = snap({ "kept.ts": " M h1", "edited.ts": " M h3", "new.ts": "?? h4" });
    expect(writesOutside(before, after, [])).toEqual(["edited.ts", "new.ts"]);
    expect(writesOutside(before, snap({ "kept.ts": " M h1" }), [])).toEqual(["edited.ts"]);
  });

  it("keeps files whose declared writes match exactly or by path suffix", () => {
    const after = snap({ "src/app/page.tsx": "?? a", "src/app/other.ts": "?? b" });
    expect(writesOutside(new Map(), after, ["page.tsx"])).toEqual(["src/app/other.ts"]);
    expect(writesOutside(new Map(), after, ["src/app/page.tsx"])).toEqual(["src/app/other.ts"]);
    expect(writesOutside(new Map(), after, ["./page.tsx"])).toEqual(["src/app/other.ts"]);
  });

  it("reports rename targets but not their original paths", () => {
    const before = snap({ "old-name.ts": " M h1" });
    const after = snap({ "new-name.ts": "R  h1", "old-name.ts": "renamed-from" });
    expect(writesOutside(before, after, [])).toEqual(["new-name.ts"]);
  });
});

describe("writesSnapshot against a real repo", () => {
  const run = (args: string[], cwd: string) => new Promise<void>((resolve, reject) => execFile("git", args, { cwd }, (err) => err ? reject(err) : resolve()));
  const dirs: string[] = [];
  const repo = async (): Promise<string> => {
    const dir = mkdtempSync(join(tmpdir(), "omb-writes-audit-"));
    dirs.push(dir);
    await run(["init", "-q"], dir);
    await run(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], dir);
    return dir;
  };
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  it("sees a new undeclared file and skips the declared one", async () => {
    const dir = await repo();
    writeFileSync(join(dir, "page.tsx"), "declared");
    const before = await writesSnapshot(dir);
    writeFileSync(join(dir, "stray.txt"), "stray");
    const after = await writesSnapshot(dir);
    expect(writesOutside(before!, after!, ["page.tsx"])).toEqual(["stray.txt"]);
  }, 20_000);

  it("sees a second edit to a file that was already modified before the snapshot", async () => {
    const dir = await repo();
    writeFileSync(join(dir, "app.ts"), "v1");
    await run(["add", "app.ts"], dir);
    await run(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "app"], dir);
    writeFileSync(join(dir, "app.ts"), "v2 by the worker");
    const before = await writesSnapshot(dir);
    writeFileSync(join(dir, "app.ts"), "v3 by the tester");
    const after = await writesSnapshot(dir);
    expect(writesOutside(before!, after!, [])).toEqual(["app.ts"]);
    expect(writesOutside(after!, after!, [])).toEqual([]);
  }, 20_000);

  it("lists files inside a new folder one by one, so a declared file there is not flagged", async () => {
    const dir = await repo();
    const before = await writesSnapshot(dir);
    mkdirSync(join(dir, "src", "new"), { recursive: true });
    writeFileSync(join(dir, "src", "new", "a.ts"), "declared");
    writeFileSync(join(dir, "src", "new", "b.ts"), "stray");
    const after = await writesSnapshot(dir);
    expect(writesOutside(before!, after!, ["src/new/a.ts"])).toEqual(["src/new/b.ts"]);
  }, 20_000);

  it("a staged new file does not hide the record after it", async () => {
    const dir = await repo();
    const before = await writesSnapshot(dir);
    writeFileSync(join(dir, "added.ts"), "a");
    writeFileSync(join(dir, "zz-stray.ts"), "b");
    await run(["add", "added.ts"], dir);
    const after = await writesSnapshot(dir);
    expect(writesOutside(before!, after!, []).sort()).toEqual(["added.ts", "zz-stray.ts"]);
  }, 20_000);

  it("stays silent outside a repository, and reads the repo from a subfolder", async () => {
    const plain = mkdtempSync(join(tmpdir(), "omb-writes-plain-"));
    dirs.push(plain);
    expect(await writesSnapshot(plain)).toBeUndefined();
    const dir = await repo();
    mkdirSync(join(dir, "room"));
    const before = await writesSnapshot(join(dir, "room"));
    writeFileSync(join(dir, "room", "page.tsx"), "x");
    const after = await writesSnapshot(join(dir, "room"));
    expect(writesOutside(before!, after!, ["page.tsx"])).toEqual([]);
    expect(writesOutside(before!, after!, [])).toEqual(["room/page.tsx"]);
  }, 20_000);
});
