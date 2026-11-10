/** Off unless explicitly enabled; when off, delegated turns run at the bot's own level exactly as before. */
export function roleCeilingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OMB_ROLE_CEILING === "1";
}
