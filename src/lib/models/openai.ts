import { ModelCallResult, ModelCallError } from "./types";
import { fetchWithTimeout, isTimeoutError } from "./fetchTimeout";

// Server-side only — never import this from client components (§1).
export async function callOpenAI(
  apiKey: string,
  modelSnapshot: string,
  prompt: string
): Promise<ModelCallResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      // No temperature/sampling override — leave at the provider's default (§2).
      body: JSON.stringify({
        model: modelSnapshot,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    // Timeouts are retryable (§5) — a hung request shouldn't block the rest
    // of the batch's Promise.all forever, but it also isn't a permanent failure.
    if (isTimeoutError(err)) throw new ModelCallError(`OpenAI: ${err.message}`, true);
    throw new ModelCallError(
      `OpenAI request failed: ${err instanceof Error ? err.message : "Unknown network error."}`,
      true
    );
  }

  const bodyText = await res.text();

  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new ModelCallError(
      `OpenAI API error ${res.status}: ${bodyText.slice(0, 500)}`,
      retryable,
      res.status
    );
  }

  let json: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ModelCallError("OpenAI API returned non-JSON response.", false);
  }

  const text = json.choices?.[0]?.message?.content ?? "";
  return {
    text,
    raw: bodyText,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  };
}
