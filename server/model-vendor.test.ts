import { describe, expect, it } from "vitest";
import { UNKNOWN_VENDOR, modelVendor } from "./model-vendor.ts";

describe("modelVendor", () => {
  it("maps single-provider engines to their vendor", () => {
    expect(modelVendor("claudeAgent", "claude-sonnet-5")).toBe("anthropic");
    expect(modelVendor("codex", "gpt-5.6")).toBe("openai");
    expect(modelVendor("grokAgent", "grok-5")).toBe("xai");
    expect(modelVendor("qwenAgent", "qwen4-max")).toBe("alibaba");
    expect(modelVendor("zcodeAgent", "agent-default")).toBe("zcode");
    expect(modelVendor("geminiAgent", "gemini-3")).toBe("google");
  });

  it("reads the provider from ACP/OpenCode-style model ids", () => {
    expect(modelVendor("opencodeGo", "anthropic/claude-opus-5")).toBe("anthropic");
    expect(modelVendor("opencodeGo", "openai/gpt-5.6")).toBe("openai");
    expect(modelVendor("openaiCompat", "zai/glm-5.3")).toBe("zai");
    expect(modelVendor("customAcp", "zai\\glm-5.3")).toBe("zai");
  });

  it("a single-vendor engine's model id never changes its vendor", () => {
    expect(modelVendor("claudeAgent", "openai/gpt-5.6")).toBe("anthropic");
  });

  it("never guesses: bare or missing ids stay unknown", () => {
    expect(modelVendor("opencodeGo", "some-custom-model")).toBe(UNKNOWN_VENDOR);
    expect(modelVendor("customAcp", "bare-id")).toBe(UNKNOWN_VENDOR);
    expect(modelVendor("hermesAgent", undefined)).toBe(UNKNOWN_VENDOR);
    expect(modelVendor(undefined, "claude-sonnet-5")).toBe(UNKNOWN_VENDOR);
  });

  it("an unknown vendor is never equal to a known one, but two unknowns are equal", () => {
    expect(modelVendor("hermesAgent", undefined)).toBe(modelVendor("customAcp", "bare"));
    expect(modelVendor("hermesAgent", undefined)).not.toBe("anthropic");
  });
});
