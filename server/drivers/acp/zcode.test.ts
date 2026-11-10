import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs, instanceConfigs } from "../../config.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { recordEvents, type EventRecorder } from "../../testing/events.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { BUILT_IN_DRIVERS } from "../builtIn.ts";
import { ZcodeAgentDriver, resolveZcodeModels, zcodeHome, zcodeSignedIn } from "./zcode.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "../../testing/fake-acp-cli.ts");
const MODELS = "GLM-5.3,GLM-5.3-Flash";
const homeVar = process.platform === "win32" ? "USERPROFILE" : "HOME";

describe("ZCode ACP driver", () => {
  let scratch: string;
  let instance: ProviderInstance | undefined;
  let recorder: EventRecorder | undefined;

  beforeEach(() => {
    ensureDirs();
    scratch = mkdtempSync(join(tmpdir(), "omb-zcode-contract-"));
  });
  afterEach(async () => {
    recorder?.stop();
    await instance?.dispose();
    instance = undefined;
    recorder = undefined;
    await removeTempDir(scratch);
  });

  async function create(environment: Record<string, string> = {}) {
    instance = await ZcodeAgentDriver.create({
      instanceId: `zcode-contract-${Math.random().toString(36).slice(2)}`, displayName: "ZCode", enabled: true,
      environment: { FAKE_ACP_MODELS: MODELS, FAKE_ACP_MODES: "plan,build,edit,guarded,yolo", FAKE_ACP_DUMP: join(scratch, "launch.json"), ...environment },
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
    return { instance, recorder };
  }

  const prompts = () => readFileSync(join(scratch, "launch.json.prompts.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const configCalls = () => JSON.parse(readFileSync(join(scratch, "launch.json.config.json"), "utf8")) as Array<{ method: string; params: any }>;
  const write = (home: string, name: string, contents: string) => {
    const dir = join(home, ".zcode", "v2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), contents);
  };

  it("is a built-in engine in fresh and existing fleets, beside a person's own custom ZCode instance", () => {
    expect(BUILT_IN_DRIVERS.some((driver) => driver.driverKind === "zcodeAgent")).toBe(true);
    expect(instanceConfigs({}).zcode?.driver).toBe("zcodeAgent");
    const existing = instanceConfigs({ instances: {
      claude: { driver: "claudeAgent" },
      mine: { driver: "customAcp", config: { cli: "zcode-acp-server" } },
    } });
    expect(existing.zcode?.driver).toBe("zcodeAgent");
    expect(existing.mine?.driver).toBe("customAcp");
    expect(ZcodeAgentDriver.metadata.displayName).toBe("ZCode");
    expect(ZcodeAgentDriver.metadata.access).toBe("subscription");
    expect(ZcodeAgentDriver.models).toEqual({ default: "agent-default", options: [{ id: "agent-default", label: "ZCode default" }] });
  });

  it("is signed in by a ZCode provider key, a bridge account, or the desktop credential store", () => {
    const home = join(scratch, "home");
    const env = { [homeVar]: home };
    expect(zcodeHome(env)).toBe(join(home, ".zcode"));
    expect(zcodeSignedIn(env)).toBe(false);
    write(home, "config.json", JSON.stringify({ provider: { "builtin:zai-coding-plan": { enabled: true, options: {} } } }));
    expect(zcodeSignedIn(env)).toBe(false);
    write(home, "config.json", JSON.stringify({ provider: { "builtin:zai-coding-plan": { enabled: false, options: { apiKey: "plan-key" } } } }));
    expect(zcodeSignedIn(env)).toBe(false);
    write(home, "config.json", JSON.stringify({ provider: { "builtin:zai-coding-plan": { enabled: true, options: { apiKey: "plan-key" } } } }));
    expect(zcodeSignedIn(env)).toBe(true);
    const elsewhere = join(scratch, "moved");
    expect(zcodeSignedIn({ [homeVar]: join(scratch, "empty"), ZCODE_HOME: elsewhere })).toBe(false);
    mkdirSync(join(elsewhere, "v2"), { recursive: true });
    writeFileSync(join(elsewhere, "v2", "acp-accounts.json"), JSON.stringify({ version: 1, accounts: { zai: { apiKey: "bridge-key" } } }));
    expect(zcodeSignedIn({ [homeVar]: join(scratch, "empty"), ZCODE_HOME: elsewhere })).toBe(true);
    const oauth = join(scratch, "oauth");
    mkdirSync(join(oauth, ".zcode", "v2"), { recursive: true });
    writeFileSync(join(oauth, ".zcode", "v2", "credentials.json"), "{\"token\":\"stored\"}");
    expect(zcodeSignedIn({ [homeVar]: oauth })).toBe(true);
  });

  it("starts nothing when the instance is created, so a zcode-acp-server on PATH costs no launch", async () => {
    const { existsSync } = await import("node:fs");
    await create();
    expect(existsSync(join(scratch, "launch.json"))).toBe(false);
    expect(instance!.models.default).toBe("agent-default");
  });

  it("runs zcode-acp-server with no arguments, in build mode, and leaves the bridge on its own model", async () => {
    const { instance, recorder } = await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "zcode-chat", text: "hello", model: "agent-default", approvalMode: "ask" });
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
    expect(recorder.events.every((event) => event.provider === "zcodeAgent")).toBe(true);
    const launch = JSON.parse(readFileSync(join(scratch, "launch.json"), "utf8"));
    expect(launch.argv).toEqual([]);
    expect(launch.env.ZCODE_ACP_MODE).toBe("build");
    expect(launch.env.ZCODE_ACP_SHOW_COMPLETION_STATUS).toBe("0");
    expect(configCalls().filter((call) => call.method === "session/set_config_option" && call.params.configId === "mode").map((call) => call.params.value)).toEqual(["build"]);
    expect(configCalls().some((call) => call.method === "session/set_config_option" && call.params.configId === "model")).toBe(false);
  });

  it("passes a picked model through ACP", async () => {
    const { instance, recorder } = await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "zcode-model", text: "hello", model: "GLM-5.3", approvalMode: "ask" });
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
    expect(prompts().at(-1)).toMatchObject({ model: "GLM-5.3" });
  });

  it("uses yolo only under Full access", async () => {
    const { instance, recorder } = await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "zcode-full", text: "hello", model: "agent-default", approvalMode: "full" });
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
    const launch = JSON.parse(readFileSync(join(scratch, "launch.json"), "utf8"));
    expect(launch.env.ZCODE_ACP_MODE).toBe("yolo");
    expect(configCalls().filter((call) => call.method === "session/set_config_option" && call.params.configId === "mode").map((call) => call.params.value)).toEqual(["yolo"]);
  });

  it("lists the bridge's providerId\\modelId models in the picker", async () => {
    const ids = ["new-provider\\glm/glm-5.3", "new-provider-2\\deepseek-v4-pro"];
    const catalog = await resolveZcodeModels({ ...process.env, FAKE_ACP_MODELS: ids.join(",") }, { cli: FAKE_CLI });
    expect(catalog.options.map((option) => option.id)).toEqual(["agent-default", ...ids]);
  });
});
