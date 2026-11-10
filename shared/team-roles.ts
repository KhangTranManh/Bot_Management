/** A member's standing role in one room's team. A room without roles runs goals as before.
 * "evaluator" belongs to research rooms (NOTE.md B3/B4): it runs the preregistered evaluation scripts. */
export const TEAM_ROLES = ["lead", "worker", "tester", "reviewer", "evaluator"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value);
}
