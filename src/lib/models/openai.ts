import { ModelCallResult, ModelCallError } from "./types";
import { fetchWithTimeout, isTimeoutError, isAbortError } from "./fetchTimeout";

// Server-side only — never import this from client components (§1).
export async function callOpenAI(
  apiKey: string,
  modelSnapshot: string,
  prompt: string,
  temperature?: number,
  signal?: AbortSignal
): Promise<ModelCallResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        // temperature is sent only when the caller passes one explicitly
        // (Rewriting, from Settings per §6) — omitted entirely otherwise
        // (Attribution), leaving the provider's own default untouched.
        body: JSON.stringify({
          model: modelSnapshot,
          messages: [{ role: "user", content: prompt }],
          ...(temperature !== undefined ? { temperature } : {}),
        }),
      },
      undefined,
      signal
    );
  } catch (err) {
    // A deliberate cancellation (Pause) — not retryable, and not really a
    // failure at all, so it shouldn't get logged as one; just stop.
    if (isAbortError(err)) throw err;
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
    model?: string;
    choices?: { message?: { content?: string }; finish_reason?: string }[];
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
    modelReturned: json.model ?? null,
    finishReason: json.choices?.[0]?.finish_reason ?? null,
  };
}
