import { buildSummaryPrompt } from "./prompt.js";
import { callAnthropic } from "./providers/anthropic.js";
import { callOpenAiCompatible } from "./providers/openai-compatible.js";
import { AiSummaryConfigError, type AiSummaryConfig, type SummaryInput } from "./types.js";

export * from "./types.js";
export { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from "./prompt.js";

/**
 * Off by default, and never implicitly triggered by a scan — the caller
 * (CLI/dashboard) must explicitly ask for a summary, and this then reads
 * provider config from explicit args or, if omitted, from the
 * ADAIYALAM_AI_PROVIDER / ADAIYALAM_AI_API_KEY / ADAIYALAM_AI_MODEL /
 * ADAIYALAM_AI_BASE_URL environment variables. No report data is ever sent
 * anywhere unless both conditions hold: the caller asked for a summary AND
 * a provider + API key are configured. Throws AiSummaryConfigError (never
 * silently returns something misleading) if configuration is missing.
 */
export function resolveAiSummaryConfig(explicit?: Partial<AiSummaryConfig>): AiSummaryConfig {
  const provider = explicit?.provider ?? (process.env.ADAIYALAM_AI_PROVIDER as AiSummaryConfig["provider"] | undefined);
  const apiKey = explicit?.apiKey ?? process.env.ADAIYALAM_AI_API_KEY;
  const model = explicit?.model ?? process.env.ADAIYALAM_AI_MODEL;
  const baseUrl = explicit?.baseUrl ?? process.env.ADAIYALAM_AI_BASE_URL;

  if (!provider) throw new AiSummaryConfigError("No AI provider configured. Set ADAIYALAM_AI_PROVIDER=anthropic|openai-compatible (or pass --ai-provider) to enable --ai-summary.");
  if (provider !== "anthropic" && provider !== "openai-compatible") {
    throw new AiSummaryConfigError(`Unknown AI provider "${provider}". Supported: anthropic, openai-compatible.`);
  }
  if (!apiKey) throw new AiSummaryConfigError("No API key configured. Set ADAIYALAM_AI_API_KEY (or pass --ai-api-key) to enable --ai-summary.");

  return { provider, apiKey, model, baseUrl };
}

export async function summarize(input: SummaryInput, config: AiSummaryConfig): Promise<string> {
  const prompt = buildSummaryPrompt(input);
  if (config.provider === "anthropic") return callAnthropic(prompt, config.apiKey, config.model);
  return callOpenAiCompatible(prompt, config.apiKey, config.model, config.baseUrl);
}
