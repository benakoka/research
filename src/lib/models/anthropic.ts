import { ModelCallResult, ModelCallError } from "./types";
import { fetchWithTimeout, isTimeoutError } from "./fetchTimeout";

// Server-side only — never import this from client components (§1).
//
// TEST-MODE ONLY: this provider exists so the pipeline (upload → run →
// export) can be exercised end-to-end on a small Anthropic API balance
// before real OpenAI/Gemini budget is available. It's wired in via
// USE_CLAUDE_FOR_TESTING (see lib/apiKeys.ts and lib/models/index.ts), not
// used in the normal GPT/Gemini code path.
export async function callAnthropic(
  apiKey: string,
  modelSnapshot: string,
  prompt: string
): Promise<ModelCallResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      // No temperature/sampling override — leave at the provider's default (§2).
      body: JSON.stringify({
        model: modelSnapshot,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    // Timeouts are retryable (§5) — a hung request shouldn't block the rest
    // of the batch's Promise.all forever, but it also isn't a permanent failure.
    if (isTimeoutError(err)) throw new ModelCallError(`Anthropic: ${err.message}`, true);
    throw new ModelCallError(
      `Anthropic request failed: ${err instanceof Error ? err.message : "Unknown network error."}`,
      true
    );
  }

  const bodyText = await res.text();

  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new ModelCallError(
      `Anthropic API error ${res.status}: ${bodyText.slice(0, 500)}`,
      retryable,
      res.status
    );
  }

  let json: {
    content?: { type?: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ModelCallError("Anthropic API returned non-JSON response.", false);
  }

  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  return {
    text,
    raw: bodyText,
    usage: {
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
    },
  };
}
