// Server-only: pulls in lib/models (fetch calls to provider APIs) and
// lib/apiKeys (server env-var secrets). Only import from API routes — see
// lib/rewriting.ts for the pure, client-safe half (building chains,
// figuring out what's runnable next).
import { randomUUID } from "crypto";
import { RewritingChain, RewritingGeneration, RewriteAttempt, RewriteAttemptLog, RewriteOutcome } from "./types";
import { callModelOnce, ModelCallError } from "./models";
import { isAbortError } from "./models/fetchTimeout";
import { getApiKey } from "./apiKeys";
import { buildRewritingPrompt } from "./rewriting";
import { countWords, missesTarget, MAX_REWRITE_ATTEMPTS } from "./wordcount";
import { containsName, looksLikeRefusal } from "./textChecks";

// §5's two explicit retry budgets are separate from the *word-count*
// ("off_target") retry loop below, which keeps using the pre-existing
// retryThresholdFraction/Enabled + MAX_REWRITE_ATTEMPTS(=10) mechanism.
// Blocked/safety finish reasons that count as a refusal even though the
// provider still returned (non-error) text to go with them.
const BLOCKED_FINISH_REASONS = new Set([
  "content_filter", // OpenAI
  "safety", // Gemini (lowercased below)
  "recitation",
  "blocklist",
  "prohibited_content",
  "spii",
  "blocked_reason_unspecified",
  "other",
]);

function isBlockedFinishReason(finishReason: string | null): boolean {
  return finishReason !== null && BLOCKED_FINISH_REASONS.has(finishReason.toLowerCase());
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt: number): number {
  const ceiling = Math.min(8_000, 1000 * 2 ** (attempt - 1));
  return Math.random() * ceiling;
}

export interface GenerationResult {
  generation: RewritingGeneration;
  // Only the NEW attempt-log entries from this call — the caller (the
  // /process route) appends them onto the chain's full attemptLog, which
  // accumulates across every call ever made for that chain.
  newAttempts: RewriteAttemptLog[];
}

/**
 * Executes one generation (§4/§5): build the prompt from the previous
 * generation's finished output, then call the model directly
 * (callModelOnce — not callModel, which has its own fixed 4-attempt retry
 * loop with no outcome visibility) in a loop that classifies every single
 * API call into one of §4's four outcomes and retries according to §5's
 * explicit, per-outcome budgets:
 *
 *   - api_error (HTTP/network/timeout/rate limit): automatic retry with
 *     backoff, up to apiErrorRetryLimit attempts.
 *   - refusal (a blocked/safety finish reason, or text that declines/
 *     apologizes, or that contains neither character's name) or empty (no
 *     text at all): retry with the identical prompt and input, up to
 *     refusalEmptyRetryLimit attempts — no backoff, nothing about the
 *     request changes.
 *   - off_target (compliant, non-refused text that misses the word-count
 *     target by more than retryThresholdFraction, only when
 *     retryThresholdEnabled): the pre-existing retry-until-compliant loop,
 *     capped at MAX_REWRITE_ATTEMPTS.
 *   - success: done.
 *
 * Exhausting any one budget marks the generation "error" and stops —
 * never silently falls through to try a different outcome's budget.
 * Every single API call, successful or not, produces exactly one
 * RewriteAttemptLog row (point 3) before any retry decision is made.
 */
export async function executeGeneration(
  promptTemplate: string,
  retryThresholdFraction: number,
  retryThresholdEnabled: boolean,
  apiErrorRetryLimit: number,
  refusalEmptyRetryLimit: number,
  temperature: number,
  chain: RewritingChain,
  genIndex: number,
  signal?: AbortSignal
): Promise<GenerationResult> {
  const apiKey = getApiKey(chain.model);
  const target = chain.wordCountTargets[genIndex - 1];
  const inputText = chain.generations[genIndex - 1].text;
  const prompt = buildRewritingPrompt(promptTemplate, target);
  const combined = `${prompt}\n\n${inputText}`;

  const legacyAttempts: RewriteAttempt[] = [];
  const newAttempts: RewriteAttemptLog[] = [];
  let parentAttemptId: string | null = null;
  let apiErrorCount = 0;
  let refusalEmptyCount = 0;
  let offTargetCount = 0;
  let attemptNumber = 0;

  function fail(error: string): GenerationResult {
    return {
      generation: {
        ...chain.generations[genIndex],
        status: "error",
        attempts: legacyAttempts,
        error,
        timestamp: new Date().toISOString(),
      },
      newAttempts,
    };
  }

  // Safety cap in case the three budgets above somehow never terminate —
  // generous (sum of realistic settings-driven limits, plus slack), never
  // meant to be hit in practice.
  const HARD_CAP = 200;
  for (let iter = 0; iter < HARD_CAP; iter++) {
    if (signal?.aborted) throw new ModelCallError("Cancelled.", false);
    attemptNumber++;
    const attemptId = randomUUID();
    const timestamp = new Date().toISOString();

    let outcome: RewriteOutcome;
    let text = "";
    let raw: string | null = null;
    let modelReturned: string | null = null;
    let finishReason: string | null = null;
    let errorMessage: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let wordCount = 0;
    let bothNamesPresent = false;
    let retryableApiError = true;

    try {
      const result = await callModelOnce(chain.model, apiKey, chain.model_snapshot, combined, temperature, signal);
      text = result.text;
      raw = result.raw;
      modelReturned = result.modelReturned;
      finishReason = result.finishReason;
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
      wordCount = countWords(text);
      bothNamesPresent =
        containsName(text, chain.actor_first_name) && containsName(text, chain.actor_second_name);
      const neitherNamePresent =
        !containsName(text, chain.actor_first_name) && !containsName(text, chain.actor_second_name);

      if (isBlockedFinishReason(finishReason)) {
        outcome = "refusal";
      } else if (text.trim() === "") {
        outcome = "empty";
      } else if (neitherNamePresent || looksLikeRefusal(text)) {
        outcome = "refusal";
      } else if (retryThresholdEnabled && missesTarget(wordCount, target, retryThresholdFraction)) {
        outcome = "off_target";
      } else {
        outcome = "success";
      }

      if (outcome !== "success") {
        legacyAttempts.push({ attempt: legacyAttempts.length + 1, text, word_count: wordCount });
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      outcome = "api_error";
      errorMessage =
        err instanceof ModelCallError ? err.message : err instanceof Error ? err.message : "Unknown model call error.";
      retryableApiError = err instanceof ModelCallError ? err.retryable : true;
    }

    const wordDiff = Math.abs(wordCount - target);
    const logEntry: RewriteAttemptLog = {
      attempt_id: attemptId,
      chain_id: chain.id,
      vignette_id: chain.vignette_id,
      base_vignette_id: chain.base_vignette_id,
      name_race: chain.name_race,
      order_variant: chain.order_variant,
      model_requested: chain.model,
      model_returned: modelReturned,
      temperature,
      generation: genIndex,
      attempt_number: attemptNumber,
      parent_attempt_id: parentAttemptId,
      target_words: target,
      output_words: wordCount,
      word_diff: wordDiff,
      outcome,
      finish_reason: finishReason,
      error_message: errorMessage,
      timestamp,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      both_names_present: bothNamesPresent,
      output_text: text,
      raw_response: raw,
    };
    newAttempts.push(logEntry);
    parentAttemptId = attemptId;

    if (outcome === "success") {
      return {
        generation: {
          generation: genIndex,
          text,
          target_word_count: target,
          actual_word_count: wordCount,
          status: "done",
          attempts: legacyAttempts,
          raw_response: raw,
          error: null,
          timestamp,
        },
        newAttempts,
      };
    }

    if (outcome === "api_error") {
      apiErrorCount++;
      if (!retryableApiError || apiErrorCount >= apiErrorRetryLimit) {
        return fail(
          `Failed at generation ${genIndex}: API error, never succeeded in ${apiErrorCount} attempt${apiErrorCount === 1 ? "" : "s"}. Last error: ${errorMessage}`
        );
      }
      await sleep(backoffDelayMs(apiErrorCount));
      continue;
    }

    if (outcome === "refusal" || outcome === "empty") {
      refusalEmptyCount++;
      if (refusalEmptyCount >= refusalEmptyRetryLimit) {
        return fail(
          `Failed at generation ${genIndex}: ${refusalEmptyCount} ${outcome} response${refusalEmptyCount === 1 ? "" : "s"} in a row (identical prompt/input each time), never a usable rewrite.`
        );
      }
      continue;
    }

    // off_target
    offTargetCount++;
    if (offTargetCount >= MAX_REWRITE_ATTEMPTS) {
      return fail(
        `Failed at generation ${genIndex}: never reached the target word count (${target} ±${Math.round(retryThresholdFraction * 100)}%) in ${MAX_REWRITE_ATTEMPTS} attempts. Last attempt: ${wordCount} words.`
      );
    }
  }

  return fail(`Failed at generation ${genIndex}: exceeded the internal safety cap of ${HARD_CAP} attempts.`);
}
