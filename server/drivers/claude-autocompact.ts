/** OMB_CLAUDE_AUTOCOMPACT: a token count, "auto" (the CLI's own window) or "off". The CLI rejects
 * a window outside 100k-1M as an argument error, so a configured value is clamped. */
export function autoCompactWindow(env: NodeJS.ProcessEnv): string | null {
  const raw = (env.OMB_CLAUDE_AUTOCOMPACT ?? "").trim().toLowerCase();
  if (raw === "off") return null;
  if (raw === "auto") return "auto";
  const parsed = raw ? Number(raw) : DEFAULT_AUTOCOMPACT_TOKENS;
  if (!Number.isFinite(parsed) || parsed <= 0) return String(DEFAULT_AUTOCOMPACT_TOKENS);
  return String(Math.min(1_000_000, Math.max(100_000, Math.floor(parsed))));
}

const DEFAULT_AUTOCOMPACT_TOKENS = 200_000;

