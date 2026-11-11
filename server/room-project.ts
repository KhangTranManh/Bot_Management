import type { RoomProjectProfile, VerifyCommand } from "../shared/wire.ts";
import type { GoalBaseline, GoalCheckResult } from "../shared/group-goal-run.ts";
import { redactSecretsInText } from "../shared/redact.ts";
import { checkedVerifyCommands } from "./verify-config.ts";
import type { VerifyResult } from "./verify-run.ts";

export function checkedProjectProfile(raw: unknown): RoomProjectProfile {
  const fail = (message: string): never => { throw Object.assign(new Error(`projectProfile ${message}`), { status: 400 }); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("must be an object or null");
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["instructions", "moduleMap", "protectedPaths", "setup"].includes(key))) return fail("contains an unknown field");
  const text = (key: string): string | undefined => {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length > 4_000) return fail(`${key} must be at most 4000 characters`);
    return value.trim() || undefined;
  };
  let protectedPaths: string[] | undefined;
  if (record.protectedPaths !== undefined) {
    if (!Array.isArray(record.protectedPaths) || record.protectedPaths.length > 16) return fail("protectedPaths must be a list of at most 16 relative paths");
    protectedPaths = record.protectedPaths.map((value: unknown) => {
      if (typeof value !== "string" || !value.trim() || value.length > 200) return fail("protectedPaths entries must be 1-200 characters");
      const path = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
      if (!path || path === "." || path.split("/").includes("..") || /^\/|^[A-Za-z]:/.test(path)) return fail("protectedPaths must stay inside the room folder");
      return path;
    });
  }
  const instructions = text("instructions"), moduleMap = text("moduleMap");
  return {
    ...(instructions ? { instructions } : {}), ...(moduleMap ? { moduleMap } : {}),
    ...(protectedPaths?.length ? { protectedPaths } : {}),
    ...(record.setup !== undefined ? { setup: checkedVerifyCommands(record.setup, "projectProfile setup") } : {}),
  };
}

export function goalCheckResult(command: VerifyCommand, result: VerifyResult): GoalCheckResult {
  return { id: redactSecretsInText(command.id), exitCode: result.exitCode, expectExit: command.expectExit ?? 0, output: redactSecretsInText(result.output).slice(-1_000) };
}

export const checkPassed = (check: GoalCheckResult): boolean => check.exitCode === check.expectExit;

export async function prepareProject(profile: RoomProjectProfile, verify: readonly VerifyCommand[], deps: {
  cancelled(): boolean;
  progress(detail: string): void;
  runVerify?(command: VerifyCommand): Promise<VerifyResult>;
}): Promise<{ baseline: GoalBaseline; failure?: string; context: string; note: string } | undefined> {
  const baseline: GoalBaseline = { startedAt: Date.now(), finishedAt: 0, setup: [], checks: [] };
  for (const [phase, commands] of [["setup", profile.setup ?? []], ["checks", verify]] as const) {
    for (const command of commands) {
      if (deps.cancelled()) return undefined;
      deps.progress(`Preparing project: ${phase === "setup" ? "setup" : "baseline check"} ${command.id}`);
      const result = deps.runVerify ? await deps.runVerify(command) : { id: command.id, exitCode: null, output: "Server command runner unavailable" };
      if (deps.cancelled()) return undefined;
      const check = goalCheckResult(command, result);
      baseline[phase].push(check);
      if (phase === "setup" && !checkPassed(check)) {
        baseline.finishedAt = Date.now();
        return { baseline, context: "", note: "", failure: `Project setup ${check.id} failed (exit ${check.exitCode ?? "unavailable"}, expected ${check.expectExit}): ${check.output.slice(-200)}` };
      }
    }
  }
  if (deps.cancelled()) return undefined;
  baseline.finishedAt = Date.now();
  const failures = baseline.checks.filter((check) => !checkPassed(check));
  const note = baseline.checks.length
    ? `Project baseline: ${baseline.checks.length - failures.length}/${baseline.checks.length} checks passed${failures.length ? `; already failing: ${failures.map((check) => check.id).join(", ")}` : ""}`
    : "Project baseline: no verify commands configured; unverified";
  return { baseline, note, context: projectContext(profile, verify, baseline) };
}

export function projectContext(profile: RoomProjectProfile, verify: readonly VerifyCommand[], baseline: GoalBaseline): string {
  return redactSecretsInText([
    "Room project profile:",
    ...(profile.instructions ? [`Project conventions (also follow the repository's AGENTS.md/CLAUDE.md):\n${profile.instructions}`] : []),
    ...(profile.moduleMap ? [`Module map:\n${profile.moduleMap}`] : []),
    ...(profile.protectedPaths?.length ? [`Do not edit these project paths: ${profile.protectedPaths.join(", ")}. Ask the person if the goal requires changing them.`] : []),
    ...(verify.length ? ["Room completion commands:", ...verify.map((command) => `- ${command.id}: ${command.command}${command.cwd ? ` (in ${command.cwd})` : ""}`)] : []),
    "Server baseline before any bot worked (existing failures are not evidence of a Worker regression; final completion checks must still pass):",
    ...(baseline.checks.length ? baseline.checks.map((check) => `- ${check.id}: ${checkPassed(check) ? "PASS" : "FAIL"}, exit ${check.exitCode ?? "unavailable"}, expected ${check.expectExit}${check.output ? `\n${check.output}` : ""}`) : ["No verify commands configured; the baseline is unverified."]),
  ].join("\n"));
}
