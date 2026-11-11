import type { VerifyCommand } from "../shared/wire.ts";

export function checkedVerifyCommands(raw: unknown, field = "verify"): VerifyCommand[] {
  const fail = (message: string): never => { throw Object.assign(new Error(`${field} ${message}`), { status: 400 }); };
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return fail("must be a list of 1 to 8 commands");
  return raw.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail("entries must be objects");
    const { id, command, cwd, timeoutSec, expectExit } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim() || id.length > 60) return fail("id must be 1-60 characters");
    if (typeof command !== "string" || !command.trim() || command.length > 2_000) return fail("command must be 1-2000 characters");
    if (cwd !== undefined && (typeof cwd !== "string" || cwd === "" || cwd.includes("..") || /[/\\]$/.test(cwd) || /^[/\\]|^[A-Za-z]:/.test(cwd))) {
      return fail("cwd must be a relative subfolder of the room's working folder");
    }
    if (timeoutSec !== undefined && (typeof timeoutSec !== "number" || !Number.isFinite(timeoutSec) || timeoutSec < 1 || timeoutSec > 3_600)) {
      return fail("timeoutSec must be between 1 and 3600");
    }
    if (expectExit !== undefined && (typeof expectExit !== "number" || !Number.isInteger(expectExit))) return fail("expectExit must be an integer");
    return { id: id.trim(), command: command.trim(), ...(cwd !== undefined ? { cwd } : {}), ...(timeoutSec !== undefined ? { timeoutSec } : {}), ...(expectExit !== undefined ? { expectExit } : {}) };
  });
}
