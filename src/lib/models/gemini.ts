import { ModelCallResult, ModelCallError } from "./types";

// Server-side only — never import this from client components (§1).
export async function callGemini(
  apiKey: string,
  modelSnapshot: string,
  prompt: string
): Promise<ModelCallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelSnapshot
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // No generationConfig.temperature override — leave at the provider's default (§2).
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

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
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ModelCallError("Gemini API returned non-JSON response.", false);
  }

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");

  return {
    text,
    raw: bodyText,
    usage: {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}
