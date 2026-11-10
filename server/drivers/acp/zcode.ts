// ZCode through the zcode-acp-server bridge (npm `zcode-acp-server` 0.83.1). The official `zcode` CLI does not speak ACP.
// Editors launch the `zcode-acp-server` bin with no arguments; that process starts `zcode app-server --stdio` itself.
// A new session starts in `yolo` (unrestricted) unless `ZCODE_ACP_MODE` or ~/.config/zcode-acp/config.json names another mode.
// The bridge advertises plan, build, edit, guarded and yolo, and accepts ACP `session/set_mode` with `modeId`.
// Its model config option id is `model` (values are `providerId\modelId`); thought level id is `thought`.
// Credentials live under `ZCODE_HOME` or `~/.zcode`: `v2/config.json` (`provider.*.options.apiKey` with `enabled`),
// `v2/provider_config.json` (`config.access.apiKey`), `v2/acp-accounts.json` from `zcode-acp setup`, or a non-empty `v2/credentials.json`.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ModelCatalog } from "../../contracts.ts";
import { userHome } from "../../env-path.ts";
import { createAcpDriver, type AccountErrorCode, type AcpConfig, type AcpSupport } from "./core.ts";
import { discoverAcpModels, type AcpDiscoveryOptions } from "./custom-model-catalog.ts";

const AGENT_DEFAULT = { id: "agent-default", label: "ZCode default" };
const MODELS: ModelCatalog = { default: AGENT_DEFAULT.id, options: [AGENT_DEFAULT] };
const SIGN_IN = "zcode-acp setup";
const LOGIN_NOTE = `ZCode is not signed in. Sign in with the ZCode app, or run \`${SIGN_IN}\` in a terminal, then check again.`;
/** `build` still asks before tools. `yolo` is the bridge's unrestricted mode (zcode-acp 0.83.1). */
const MODE_ASK = "build";
const MODE_FULL = "yolo";

export function zcodeHome(env: Record<string, string | undefined>): string {
  const override = env.ZCODE_HOME?.trim();
  return override ? override : join(userHome(env), ".zcode");
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function configSignedIn(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const providers = (raw as { provider?: unknown }).provider;
  if (!providers || typeof providers !== "object") return false;
  return Object.values(providers as Record<string, unknown>).some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const provider = entry as { enabled?: unknown; options?: { apiKey?: unknown } };
    return provider.enabled === true && nonEmpty(provider.options?.apiKey);
  });
}

function personalSignedIn(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const rules = (raw as { config?: { providerConfigRules?: { providerRules?: unknown } } }).config?.providerConfigRules?.providerRules;
  if (!Array.isArray(rules)) return false;
  return rules.some((rule) => {
    if (!rule || typeof rule !== "object") return false;
    return nonEmpty((rule as { config?: { access?: { apiKey?: unknown } } }).config?.access?.apiKey);
  });
}

function accountFileSignedIn(raw: unknown, depth = 0): boolean {
  if (depth > 6 || !raw || typeof raw !== "object") return false;
  return Object.entries(raw as Record<string, unknown>).some(([key, child]) =>
    (key === "apiKey" || key === "key" || key === "token") && nonEmpty(child) || accountFileSignedIn(child, depth + 1));
}

function credentialsPresent(path: string): boolean {
  try {
    return statSync(path).isFile() && statSync(path).size > 2;
  } catch {
    return false;
  }
}

/** True when the bridge can find a ZCode login. A missing file is signed out; a desktop OAuth store counts. */
export function zcodeSignedIn(env: Record<string, string | undefined>): boolean {
  const root = join(zcodeHome(env), "v2");
  return configSignedIn(readJson(join(root, "config.json")))
    || personalSignedIn(readJson(join(root, "provider_config.json")))
    || accountFileSignedIn(readJson(join(root, "acp-accounts.json")))
    || credentialsPresent(join(root, "credentials.json"));
}

const DISCOVERY: AcpDiscoveryOptions = { passthrough: AGENT_DEFAULT, exitGraceMs: 1_000 };

export function resolveZcodeModels(env: Record<string, string | undefined>, config: Pick<AcpConfig, "cli">): Promise<ModelCatalog> {
  return discoverAcpModels(env, config.cli, [], DISCOVERY);
}

export function describeZcodeAccountError(code: AccountErrorCode): string {
  return code === "invalid_credentials" ? LOGIN_NOTE
    : "ZCode refused this request for the signed-in account. Check its Coding Plan and credits, then try again.";
}

function zcodeMode(fullAuto: boolean): string {
  return fullAuto ? MODE_FULL : MODE_ASK;
}

const SUPPORT: AcpSupport = {
  driverKind: "zcodeAgent",
  displayName: "ZCode",
  models: MODELS,
  defaultCli: "zcode-acp-server",
  nativeSource: "zcode.acp",
  images: true,
  loginNote: LOGIN_NOTE,
  install: {
    command: { darwin: "npm install -g zcode-acp-server", linux: "npm install -g zcode-acp-server", win32: "npm install -g zcode-acp-server" },
    needsNode: true,
    docsUrl: "https://github.com/william0wang/zcode-acp",
    signInCommand: SIGN_IN,
  },
  spawnArgs: () => [],
  resolveModels: (env, config) => resolveZcodeModels(env, config),
  resolveModelsOnCreate: false,
  selectModel: { configId: "model", agentDefault: AGENT_DEFAULT.id },
  modelVariants: true,
  pickAuthMethod: () => null,
  authFailure: "continue",
  isAuthenticated: (env) => zcodeSignedIn(env),
  describeAccountError: describeZcodeAccountError,
  accountErrorText: (code) => code === "invalid_credentials" ? undefined : { key: "chat.notice.zcodeAccountRefused" },
  sessionScopedApproval: true,
  applyTurnEnv: (env, { fullAuto }) => {
    env.ZCODE_ACP_MODE = zcodeMode(fullAuto);
    // The bridge appends a completion status line as assistant text (zcode-acp 0.83.1). This client shows that text as the reply.
    env.ZCODE_ACP_SHOW_COMPLETION_STATUS = "0";
  },
  async configureSession({ request, sessionId, config }) {
    const modeId = zcodeMode(config.fullAuto);
    try {
      await request("session/set_mode", { sessionId, modeId });
    } catch (error) {
      throw new Error(`ZCode rejected permission mode "${modeId}": ${(error as Error).message}`);
    }
  },
  buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
};

export const ZcodeAgentDriver = createAcpDriver(SUPPORT);
