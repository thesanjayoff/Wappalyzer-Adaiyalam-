const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-5-5";

/**
 * Calls Anthropic's Messages API. Per https://docs.anthropic.com/en/api/messages
 * — a system string plus a single user message, non-streaming.
 */
export async function callAnthropic(prompt: { system: string; user: string }, apiKey: string, model?: string): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model ?? DEFAULT_MODEL,
      max_tokens: 400,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API request failed: ${response.status} ${response.statusText} ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic API response did not contain a text block");
  return text.trim();
}
