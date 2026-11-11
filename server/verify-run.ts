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
    execFile(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch {}
}

/** Runs one room check through the platform shell in `roomCwd` (or its `cwd` subfolder). */
export function runVerifyCommand(command: VerifyCommand, roomCwd: string, signal?: AbortSignal): Promise<VerifyResult> {
  if (signal?.aborted) return Promise.resolve({ id: command.id, exitCode: null, output: "Cancelled" });
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
    const stop = () => {
      killed = true;
      if (child.pid !== undefined) killTree(child.pid);
    };
    const timer = setTimeout(stop, (command.timeoutSec ?? 600) * 1_000);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", stop); };
    child.on("error", (err) => {
      cleanup();
      resolve({ id: command.id, exitCode: null, output: output || err.message });
    });
    child.on("close", (code) => {
      cleanup();
      resolve({ id: command.id, exitCode: killed ? null : code, output });
    });
  });
}
