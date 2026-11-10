/** The company whose model a bot runs, for the rule that a reviewer runs a different model than the work it
 * reviews. Only engines that can run nothing else name it outright; every other engine (OpenCode, ZCode,
 * Copilot, Cursor, Antigravity, Groq…) fronts several, so its model id decides. "unknown" is a real answer and
 * never counts as different. */
const SINGLE_VENDOR_DRIVER: Record<string, string> = {
  claudeAgent: "anthropic",
  claude: "anthropic",
  codex: "openai",
  openai: "openai",
  geminiAgent: "google",
  grok: "xai",
  grokAgent: "xai",
  qwenAgent: "alibaba",
  deepseekAgent: "deepseek",
  kimiAgent: "moonshot",
  mistral: "mistral",
  meta: "meta",
};

const MODEL_FAMILY: ReadonlyArray<readonly [RegExp, string]> = [
  [/^claude/, "anthropic"],
  [/^(gpt|o\d|chatgpt|codex)/, "openai"],
  [/^gemini|^gemma/, "google"],
  [/^grok/, "xai"],
  [/^glm/, "zai"],
  [/^(qwen|qwq)/, "alibaba"],
  [/^deepseek/, "deepseek"],
  [/^kimi|^moonshot/, "moonshot"],
  [/^(llama|meta-llama)/, "meta"],
  [/^(mistral|mixtral|codestral|devstral|magistral|ministral)/, "mistral"],
  [/^minimax/, "minimax"],
];

const PROVIDER_PREFIX: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  "x-ai": "xai",
  xai: "xai",
  zai: "zai",
  "z-ai": "zai",
  zhipuai: "zai",
  alibaba: "alibaba",
  qwen: "alibaba",
  deepseek: "deepseek",
  moonshotai: "moonshot",
  moonshot: "moonshot",
  "meta-llama": "meta",
  meta: "meta",
  mistralai: "mistral",
  mistral: "mistral",
  minimax: "minimax",
};

export const UNKNOWN_VENDOR = "unknown";

export function modelVendor(driverKind: string | undefined, model: string | undefined): string {
  const single = driverKind ? SINGLE_VENDOR_DRIVER[driverKind] : undefined;
  if (single) return single;
  // "provider/model", ZCode's "provider\model", or a router's "router/provider/model".
  const segments = (model ?? "").toLowerCase().split(/[/\\]/).filter(Boolean);
  const name = segments.at(-1) ?? "";
  const family = MODEL_FAMILY.find(([pattern]) => pattern.test(name));
  if (family) return family[1];
  for (const segment of segments.slice(0, -1).reverse()) {
    const vendor = PROVIDER_PREFIX[segment];
    if (vendor) return vendor;
  }
  return UNKNOWN_VENDOR;
}
