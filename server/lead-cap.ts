/** Off unless explicitly enabled; when off, goal runs behave exactly as before. */
export function leadDeptCapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OMB_LEAD_DEPT_CAP === "1";
}
