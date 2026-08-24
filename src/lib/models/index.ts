import { callOpenAI } from "./openai";
import { callGemini } from "./gemini";
import { callAnthropic } from "./anthropic";
import { ModelCallResult, ModelCallError } from "./types";
import { ModelProvider } from "@/lib/types";
import { isTestMode } from "@/lib/apiKeys";

export { ModelCallError };
export type { ModelCallResult };

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls the given model provider with retry + exponential backoff on
 * rate-limit/5xx errors (§5). Returns per-call token usage on the result so
 * the caller (an API route) can hand it back to the client for the
 * cost-visibility display — there's no server-side store to accumulate it
 * in. Throws ModelCallError on final failure so the caller can store it as
 * a per-cell error rather than crashing the batch.
 */
export async function callModel(
  provider: ModelProvider,
  apiKey: string,
  modelSnapshot: string,
  prompt: string
): Promise<ModelCallResult> {
  if (!apiKey) {
    throw new ModelCallError(
      `No ${provider} API key configured. Add one in Settings.`,
      false
    );
  }
  if (!modelSnapshot) {
    throw new ModelCallError(
      `No ${provider} model snapshot configured. Add one in Settings.`,
      false
    );
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // TEST MODE: a provider in test mode routes through Claude on the
      // Anthropic key instead of its own, so that slot's pipeline can be
      // exercised before its real budget exists — independently of whether
      // the other slot already has a real key (see lib/apiKeys.ts). Taking a
      // slot out of test mode (its own USE_CLAUDE_FOR_TESTING case) restores
      // normal dispatch for it with no other code changes needed.
      const result = isTestMode(provider)
        ? await callAnthropic(apiKey, modelSnapshot, prompt)
        : provider === "GPT"
          ? await callOpenAI(apiKey, modelSnapshot, prompt)
          : await callGemini(apiKey, modelSnapshot, prompt);
      return result;
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ModelCallError ? err.retryable : true;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }

  if (lastError instanceof ModelCallError) throw lastError;
  throw new ModelCallError(
    lastError instanceof Error ? lastError.message : "Unknown model call error.",
    false
  );
}
