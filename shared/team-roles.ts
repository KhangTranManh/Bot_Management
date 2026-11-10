/** A member's standing role in one room's team. A room without roles runs goals as before. */
export const TEAM_ROLES = ["lead", "worker", "tester", "reviewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value);
}
