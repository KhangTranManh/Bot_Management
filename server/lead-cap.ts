/** The fewest members a room needs before its goals plan parallel waves. */
export const GOAL_WAVES_MIN_MEMBERS = 3;

/** Whether a room's goal may plan parallel waves. `OMB_LEAD_DEPT_CAP=0` turns waves off everywhere and `=1` turns
 * them on for any room; a room's own `goalWaves: false` always turns them off there. */
export function goalWavesEnabled(room: { memberCount: number; goalWaves?: boolean }, env: NodeJS.ProcessEnv = process.env): boolean {
  if (room.goalWaves === false || env.OMB_LEAD_DEPT_CAP === "0") return false;
  return env.OMB_LEAD_DEPT_CAP === "1" || room.memberCount >= GOAL_WAVES_MIN_MEMBERS;
}
