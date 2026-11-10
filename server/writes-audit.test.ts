import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitStatusPorcelain, writesOutside } from "./writes-audit.ts";

const status = (path: string, code = " M"): string => `${code} ${path}`;

describe("writesOutside", () => {
  it("reports files that appeared, changed status, or vanished", () => {
    const before = [status("kept.ts"), status("edited.ts")];
    const after = [status("kept.ts"), status("edited.ts", "??"), status("new.ts", "??")];
    const gone = [status("kept.ts")];
    expect(writesOutside(before, after, [])).toEqual(["edited.ts", "new.ts"]);
    expect(writesOutside(before, gone, [])).toEqual(["edited.ts"]);
  });

  it("keeps files whose declared writes match exactly or by path suffix", () => {
    const before: string[] = [];
    const after = [status("src/app/page.tsx", "??"), status("src/app/other.ts", "??")];
    expect(writesOutside(before, after, ["page.tsx"])).toEqual(["src/app/other.ts"]);
    expect(writesOutside(before, after, ["src/app/page.tsx"])).toEqual(["src/app/other.ts"]);
    expect(writesOutside(before, after, ["./page.tsx"])).toEqual(["src/app/other.ts"]);
  });

  it("stays silent about a file that was already modified before the wave", () => {
    // Known limit: porcelain lines cannot tell a re-edit of a pre-dirty file from no change.
    const snapshot = [status("pre-dirty.ts")];
    expect(writesOutside(snapshot, snapshot, [])).toEqual([]);
  });

  it("reports a declared file deleted and an undeclared one deleted", () => {
    const before = [status("declared.md"), status("undeclared.md")];
    expect(writesOutside(before, [], ["declared.md"])).toEqual(["undeclared.md"]);
  });

  it("reports rename targets but not their original paths", () => {
    const before = [status("old-name.ts")];
    const after = ["R  new-name.ts", "old-name.ts"];
    expect(writesOutside(before, after, [])).toEqual(["new-name.ts"]);
  });
});

describe("gitStatusPorcelain against a real repo", () => {
  it("sees a new undeclared file and skips the declared one", async () => {
    const run = (args: string[], cwd: string) => new Promise<void>((resolve, reject) => execFile("git", args, { cwd }, (err) => err ? reject(err) : resolve()));
    const dir = mkdtempSync(join(tmpdir(), "omb-writes-audit-"));
    try {
      await run(["init", "-q"], dir);
      writeFileSync(join(dir, "page.tsx"), "declared");
      const before = await gitStatusPorcelain(dir);
      expect(before?.some((line) => line.endsWith("page.tsx"))).toBe(true); // untracked shows in porcelain
      writeFileSync(join(dir, "stray.txt"), "stray");
      const after = await gitStatusPorcelain(dir);
      expect(after).toBeDefined();
      expect(writesOutside(before ?? [], after ?? [], ["page.tsx"])).toEqual(["stray.txt"]);
      // A folder outside any repository keeps the audit silent.
      const plain = mkdtempSync(join(tmpdir(), "omb-writes-plain-"));
      try {
        expect(await gitStatusPorcelain(plain)).toBeUndefined();
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
