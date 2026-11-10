import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runVerifyCommand } from "./verify-run.ts";

const node = `"${process.execPath}"`;
const dir = mkdtempSync(join(tmpdir(), "omb-verify-run-"));
mkdirSync(join(dir, "sub"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("runVerifyCommand on this platform's shell", () => {
  it("reports a real exit code and the output tail", async () => {
    const passed = await runVerifyCommand({ id: "ok", command: `${node} -e "console.log('fine')"` }, dir);
    expect(passed).toEqual({ id: "ok", exitCode: 0, output: expect.stringContaining("fine") });
    const failed = await runVerifyCommand({ id: "bad", command: `${node} -e "console.error('broke'); process.exit(3)"` }, dir);
    expect(failed.exitCode).toBe(3);
    expect(failed.output).toContain("broke");
  });

  it("runs in the room folder, or in its cwd subfolder", async () => {
    const root = await runVerifyCommand({ id: "where", command: `${node} -e "console.log(process.cwd())"` }, dir);
    expect(root.output.trim()).toBe(dir);
    const sub = await runVerifyCommand({ id: "where", command: `${node} -e "console.log(process.cwd())"`, cwd: "sub" }, dir);
    expect(sub.output.trim()).toBe(join(dir, "sub"));
  });

  it("a command that outlives its timeout counts as killed, and nothing under the shell survives it", async () => {
    const started = Date.now();
    const slow = await runVerifyCommand({
      id: "slow",
      command: `${node} -e "setTimeout(() => require('fs').writeFileSync('late.txt', 'x'), 3000)"`,
      timeoutSec: 1,
    }, dir);
    expect(slow.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_900);
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    expect(existsSync(join(dir, "late.txt"))).toBe(false);
  }, 15_000);

  it("a command the shell cannot find fails", async () => {
    const missing = await runVerifyCommand({ id: "missing", command: "omb-no-such-command-xyz" }, dir);
    expect(missing.exitCode).not.toBe(0);
  });
});
