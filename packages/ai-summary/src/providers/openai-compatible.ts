const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Calls any OpenAI chat-completions-compatible endpoint (OpenAI itself, or
 * a self-hosted/compatible gateway via baseUrl) — the de facto standard
 * shape most third-party providers also implement.
 */
export async function callOpenAiCompatible(prompt: { system: string; user: string }, apiKey: string, model?: string, baseUrl?: string): Promise<string> {
  const url = `${(baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model ?? DEFAULT_MODEL,
      max_tokens: 400,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI-compatible API request failed: ${response.status} ${response.statusText} ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI-compatible API response did not contain message content");
  return text.trim();
}
