import { ModelCallResult, ModelCallError } from "./types";
import { fetchWithTimeout, isTimeoutError, isAbortError } from "./fetchTimeout";

// Server-side only — never import this from client components (§1).
export async function callGemini(
  apiKey: string,
  modelSnapshot: string,
  prompt: string,
  temperature?: number,
  signal?: AbortSignal
): Promise<ModelCallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelSnapshot
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // generationConfig.temperature is sent only when the caller passes
        // one explicitly (Rewriting, from Settings per §6) — omitted
        // otherwise (Attribution), leaving the provider's own default.
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          ...(temperature !== undefined ? { generationConfig: { temperature } } : {}),
        }),
      },
      // Longer than the shared default (30s) specifically for Gemini: under
      // real demand it can genuinely take longer than that to respond at
      // all (not erroring, just slow) — retrying a call that consistently
      // needs more time than the timeout doesn't help, it just repeats the
      // same cutoff. GPT/Anthropic haven't shown this, so left at the
      // shared default rather than bumped speculatively.
      45_000,
      signal
    );
  } catch (err) {
    // A deliberate cancellation (Pause) — not retryable, and not really a
    // failure at all, so it shouldn't get logged as one; just stop.
    if (isAbortError(err)) throw err;
    // Timeouts are retryable (§5) — a hung request shouldn't block the rest
    // of the batch's Promise.all forever, but it also isn't a permanent failure.
    if (isTimeoutError(err)) throw new ModelCallError(`Gemini: ${err.message}`, true);
    throw new ModelCallError(
      `Gemini request failed: ${err instanceof Error ? err.message : "Unknown network error."}`,
      true
    );
  }

  const bodyText = await res.text();

  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new ModelCallError(
      `Gemini API error ${res.status}: ${bodyText.slice(0, 500)}`,
      retryable,
      res.status
    );
  }

  let json: {
    modelVersion?: string;
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ModelCallError("Gemini API returned non-JSON response.", false);
  }

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  // A prompt blocked before generation (e.g. safety) comes back with no
  // candidates at all and the reason on promptFeedback instead of a
  // per-candidate finishReason — check both.
  const finishReason = json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? null;

  return {
    text,
    raw: bodyText,
    usage: {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
    modelReturned: json.modelVersion ?? null,
    finishReason,
  };
}
