/** The upstream model vendor a bot runs on (NOTE.md B4/§8.5): the engine is not the vendor — OpenCode,
 * ZCode and other ACP agents front many providers, and their model ids carry the vendor as the segment
 * before "/" (or ZCode's "\\"). "unknown" is a real answer: an unknown vendor never counts as different. */
const DRIVER_VENDOR: Record<string, string> = {
  claudeAgent: "anthropic",
  claude: "anthropic",
  codex: "openai",
  geminiAgent: "google",
  antigravityAgent: "google",
  grok: "xai",
  grokAgent: "xai",
  qwenAgent: "alibaba",
  deepseekAgent: "deepseek",
  kimiAgent: "moonshot",
  minimax: "minimax",
  mistral: "mistral",
  cerebras: "cerebras",
  groq: "groq",
  meta: "meta",
  zcodeAgent: "zcode",
  copilotAgent: "github",
  cursorAgent: "cursor",
  droidAgent: "factory",
};

export const UNKNOWN_VENDOR = "unknown";

export function modelVendor(driverKind: string | undefined, model: string | undefined): string {
  const known = driverKind ? DRIVER_VENDOR[driverKind] : undefined;
  if (known) return known;
  // Multi-provider agents carry the vendor in the model id: "provider/model" (or ZCode's "provider\\model").
  const id = model ?? "";
  const split = [id.indexOf("/"), id.indexOf("\\")].filter((at) => at > 0).sort((a, b) => a - b)[0];
  return split === undefined ? UNKNOWN_VENDOR : id.slice(0, split).toLowerCase();
}
