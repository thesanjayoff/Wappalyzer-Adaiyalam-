import { afterEach, describe, expect, it } from "vitest";
import { resolveAiSummaryConfig } from "./index.js";
import { AiSummaryConfigError } from "./types.js";

const ENV_KEYS = ["ADAIYALAM_AI_PROVIDER", "ADAIYALAM_AI_API_KEY", "ADAIYALAM_AI_MODEL", "ADAIYALAM_AI_BASE_URL"];

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("resolveAiSummaryConfig", () => {
  afterEach(clearEnv);

  it("throws AiSummaryConfigError when no provider is configured at all", () => {
    clearEnv();
    expect(() => resolveAiSummaryConfig()).toThrow(AiSummaryConfigError);
  });

  it("throws when a provider is set but no API key is", () => {
    clearEnv();
    expect(() => resolveAiSummaryConfig({ provider: "anthropic" })).toThrow(/API key/);
  });

  it("throws on an unknown provider name rather than silently defaulting", () => {
    expect(() => resolveAiSummaryConfig({ provider: "not-a-real-provider" as never, apiKey: "x" })).toThrow(/Unknown AI provider/);
  });

  it("resolves from explicit args when given", () => {
    const config = resolveAiSummaryConfig({ provider: "anthropic", apiKey: "sk-test", model: "claude-haiku-5-5" });
    expect(config).toEqual({ provider: "anthropic", apiKey: "sk-test", model: "claude-haiku-5-5", baseUrl: undefined });
  });

  it("falls back to environment variables when no explicit config is given", () => {
    process.env.ADAIYALAM_AI_PROVIDER = "openai-compatible";
    process.env.ADAIYALAM_AI_API_KEY = "env-key";
    const config = resolveAiSummaryConfig();
    expect(config.provider).toBe("openai-compatible");
    expect(config.apiKey).toBe("env-key");
  });

  it("explicit args take precedence over environment variables", () => {
    process.env.ADAIYALAM_AI_PROVIDER = "openai-compatible";
    process.env.ADAIYALAM_AI_API_KEY = "env-key";
    const config = resolveAiSummaryConfig({ provider: "anthropic", apiKey: "explicit-key" });
    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBe("explicit-key");
  });
});
