import { describe, expect, it } from "vitest";
import { UNKNOWN_VENDOR, modelVendor } from "./model-vendor.ts";

describe("modelVendor", () => {
  it("maps single-vendor engines to their vendor", () => {
    expect(modelVendor("claudeAgent", "claude-sonnet-5")).toBe("anthropic");
    expect(modelVendor("codex", "gpt-5.6")).toBe("openai");
    expect(modelVendor("grokAgent", "grok-5")).toBe("xai");
    expect(modelVendor("qwenAgent", "qwen4-max")).toBe("alibaba");
    expect(modelVendor("geminiAgent", "gemini-3")).toBe("google");
  });

  it("a single-vendor engine's model id never changes its vendor", () => {
    expect(modelVendor("claudeAgent", "openai/gpt-5.6")).toBe("anthropic");
  });

  it("reads the provider from ACP/OpenCode-style model ids", () => {
    expect(modelVendor("opencodeGo", "anthropic/claude-opus-5")).toBe("anthropic");
    expect(modelVendor("opencodeGo", "openai/gpt-5.6")).toBe("openai");
    expect(modelVendor("openaiCompat", "zai/glm-5.3")).toBe("zai");
    expect(modelVendor("customAcp", "zai\\glm-5.3")).toBe("zai");
  });

  it("a multi-vendor engine takes the vendor of the model it runs, not its own name", () => {
    expect(modelVendor("zcodeAgent", "anthropic\\claude-sonnet-5")).toBe("anthropic");
    expect(modelVendor("zcodeAgent", "zai\\glm-5.3")).toBe("zai");
    expect(modelVendor("copilotAgent", "claude-sonnet-5")).toBe("anthropic");
    expect(modelVendor("copilotAgent", "gpt-5.6")).toBe("openai");
    expect(modelVendor("cursorAgent", "gpt-5.6")).toBe("openai");
    expect(modelVendor("antigravityAgent", "claude-sonnet-5")).toBe("anthropic");
    expect(modelVendor("groq", "llama-4-maverick")).toBe("meta");
    expect(modelVendor("groq", "openai/gpt-oss-120b")).toBe("openai");
  });

  it("a router prefix is not the vendor", () => {
    expect(modelVendor("opencodeGo", "openrouter/anthropic/claude-opus-5")).toBe("anthropic");
    expect(modelVendor("opencodeGo", "openrouter/x-ai/some-new-model")).toBe("xai");
  });

  it("never guesses: bare, unbranded or missing ids stay unknown", () => {
    expect(modelVendor("zcodeAgent", "agent-default")).toBe(UNKNOWN_VENDOR);
    expect(modelVendor("droidAgent", "custom")).toBe(UNKNOWN_VENDOR);
    expect(modelVendor("opencodeGo", "some-custom-model")).toBe(UNKNOWN_VENDOR);
    expect(modelVendor("opencodeGo", "openrouter/some-custom-model")).toBe(UNKNOWN_VENDOR);
    expect(modelVendor("customAcp", "bare-id")).toBe(UNKNOWN_VENDOR);
    expect(modelVendor("hermesAgent", undefined)).toBe(UNKNOWN_VENDOR);
  });

  it("an unknown engine still reads a branded model id", () => {
    expect(modelVendor(undefined, "claude-sonnet-5")).toBe("anthropic");
  });
});
