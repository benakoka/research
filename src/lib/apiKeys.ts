import { ModelProvider } from "./types";

/**
 * OpenAI/Gemini API keys live in Vercel environment variables, not in the
 * Settings screen / KV store — they're operator-level secrets for a
 * single-tenant tool behind one shared password, not per-run configuration.
 * Set OPENAI_API_KEY / GEMINI_API_KEY in the Vercel project (or .env.local
 * for dev).
 */
export function getApiKey(provider: ModelProvider): string {
  return provider === "GPT"
    ? process.env.OPENAI_API_KEY ?? ""
    : process.env.GEMINI_API_KEY ?? "";
}
