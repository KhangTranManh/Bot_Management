/** A server-run room command; completion checks use real exit codes after the Tester passes.
 * A project profile also runs these checks before any bot turn to record existing failures. */
export interface VerifyCommand {
  /** Stable id, named in reports. */
  id: string;
  /** The shell command line, run in the room's working folder (or `cwd` under it). */
  command: string;
  /** A relative subfolder of the room's working folder; ".." and absolute paths are refused. */
  cwd?: string;
  /** Seconds before the command is killed; default 600. */
  timeoutSec?: number;
  /** The exit code that counts as passed; default 0. */
  expectExit?: number;
}

/** Optional project context for room goals; enabling it runs setup and a verify baseline before the first bot turn. */
export interface RoomProjectProfile {
  /** Saved outline used by new goal runs when their conversation has no ready plan card. */
  plan?: import("./room-plan.ts").RoomPlanDraft;
  /** Optional planning template; supplies guidance without changing files or verify commands. */
  template?: import("./project-template.ts").ProjectTemplate;
  /** Project conventions and references to repository instructions; at most 4000 characters. */
  instructions?: string;
  /** A concise map of the modules the team works on; at most 4000 characters. */
  moduleMap?: string;
  /** Relative files or folders the bots are instructed to leave alone; advisory, not a filesystem sandbox. */
  protectedPaths?: string[];
  /** Server-run setup commands before each goal's baseline; a failure blocks the goal before any bot works. */
  setup?: VerifyCommand[];
}
