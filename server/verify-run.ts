import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import type { VerifyCommand } from "../shared/wire.ts";

export interface VerifyResult {
  id: string;
  /** Null when the command was killed (timeout) or could not start. */
  exitCode: number | null;
  output: string;
}

const OUTPUT_TAIL = 2_000;

/** Node's shell timeout kills only the shell; on Windows the command under cmd.exe keeps running and holds the
 * folder, so the whole tree goes. */
function killTree(pid: number): void {
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch {}
}

/** Runs one room check through the platform shell in `roomCwd` (or its `cwd` subfolder). */
export function runVerifyCommand(command: VerifyCommand, roomCwd: string): Promise<VerifyResult> {
  return new Promise((resolve) => {
    let output = "";
    let killed = false;
    const keep = (chunk: Buffer): void => { output = (output + chunk.toString()).slice(-OUTPUT_TAIL); };
    const child = spawn(command.command, {
      cwd: command.cwd ? join(roomCwd, command.cwd) : roomCwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      killed = true;
      if (child.pid !== undefined) killTree(child.pid);
    }, (command.timeoutSec ?? 600) * 1_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ id: command.id, exitCode: null, output: output || err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ id: command.id, exitCode: killed ? null : code, output });
    });
  });
}
