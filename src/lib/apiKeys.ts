import { ModelProvider } from "./types";

/**
 * OpenAI/Gemini API keys live in Vercel environment variables, not in the
 * Settings screen / KV store — they're operator-level secrets for a
 * single-tenant tool behind one shared password, not per-run configuration.
 * Set OPENAI_API_KEY / GEMINI_API_KEY in the Vercel project (or .env.local
 * for dev).
 *
 * TEST MODE: before real OpenAI/Gemini budget exists, set
 * USE_CLAUDE_FOR_TESTING=true and ANTHROPIC_API_KEY to exercise the full
 * upload → run → export pipeline against Claude instead — see
 * lib/models/index.ts. This is for pipeline testing only: Claude output is
 * not a substitute for the real GPT/Gemini data the study is about, so
 * don't keep test-mode runs around once real keys are in. Flip
 * USE_CLAUDE_FOR_TESTING off (or just set the real keys and leave it unset)
 * to go back to normal — no other code changes needed.
 */
export function isTestMode(): boolean {
  return process.env.USE_CLAUDE_FOR_TESTING === "true";
}

export function getApiKey(provider: ModelProvider): string {
  if (isTestMode()) {
    return process.env.ANTHROPIC_API_KEY ?? "";
  }
  return provider === "GPT"
    ? process.env.OPENAI_API_KEY ?? ""
    : process.env.GEMINI_API_KEY ?? "";
}
