import { ModelProvider } from "./types";

/**
 * OpenAI/Gemini API keys live in Vercel environment variables, not in the
 * Settings screen / KV store — they're operator-level secrets for a
 * single-tenant tool behind one shared password, not per-run configuration.
 * Set OPENAI_API_KEY / GEMINI_API_KEY in the Vercel project (or .env.local
 * for dev).
 *
 * TEST MODE: before real OpenAI/Gemini budget exists for a given provider,
 * exercise the full upload → run → export pipeline against Claude instead —
 * see lib/models/index.ts. USE_CLAUDE_FOR_TESTING controls which slot(s)
 * this applies to (case-insensitive):
 *   - "true"   — both the GPT and Gemini slots route through Claude
 *   - "gpt"    — only the GPT slot routes through Claude (real Gemini key)
 *   - "gemini" — only the Gemini slot routes through Claude (real GPT key)
 *   - unset (or anything else) — normal dispatch for both
 * Either way, a slot in test mode reads ANTHROPIC_API_KEY, not its own
 * OPENAI_API_KEY/GEMINI_API_KEY. This is for pipeline testing only: Claude
 * output is not a substitute for the real GPT/Gemini data the study is
 * about, so don't keep test-mode runs around once real keys are in for that
 * slot. Flip a slot out of test mode (or just set its real key and leave
 * USE_CLAUDE_FOR_TESTING covering only the other slot) to go back to
 * normal for it — no other code changes needed.
 */
export function isTestMode(provider: ModelProvider): boolean {
  const mode = process.env.USE_CLAUDE_FOR_TESTING?.trim().toLowerCase();
  if (mode === "true") return true;
  if (mode === "gpt") return provider === "GPT";
  if (mode === "gemini") return provider === "Gemini";
  return false;
}

export function getApiKey(provider: ModelProvider): string {
  if (isTestMode(provider)) {
    return process.env.ANTHROPIC_API_KEY ?? "";
  }
  return provider === "GPT"
    ? process.env.OPENAI_API_KEY ?? ""
    : process.env.GEMINI_API_KEY ?? "";
}
