// Server-only: pulls in lib/models (fetch calls to provider APIs) and
// lib/apiKeys (server env-var secrets). Only import from API routes — see
// lib/rewriting.ts for the pure, client-safe half (building chains,
// figuring out what's runnable next).
import { RewritingChain, RewritingGeneration, RewriteAttempt } from "./types";
import { callModel, ModelCallError } from "./models";
import { getApiKey } from "./apiKeys";
import { buildRewritingPrompt } from "./rewriting";
import { countWords, missesTarget, MAX_REWRITE_ATTEMPTS } from "./wordcount";

/**
 * Executes one generation (§4, confirmed protocol): build the prompt from
 * the previous generation's finished output, call the model, and on a miss
 * keep retrying — re-sending that exact same source text again each time,
 * never the failed attempt itself — until the result complies or
 * MAX_REWRITE_ATTEMPTS is hit. Every attempt (not just the first) is kept as
 * compliance data. Exhausting the cap without ever complying is a hard error
 * for this generation, which blocks the rest of its chain, rather than a
 * silent accept of non-compliant text.
 */
export async function executeGeneration(
  promptTemplate: string,
  retryThresholdFraction: number,
  chain: RewritingChain,
  genIndex: number
): Promise<RewritingGeneration> {
  const apiKey = getApiKey(chain.model);
  const target = chain.wordCountTargets[genIndex - 1];
  const inputText = chain.generations[genIndex - 1].text;
  const prompt = buildRewritingPrompt(promptTemplate, target);
  const combined = `${prompt}\n\n${inputText}`;

  const attempts: RewriteAttempt[] = [];
  try {
    for (let attemptNum = 1; attemptNum <= MAX_REWRITE_ATTEMPTS; attemptNum++) {
      const result = await callModel(chain.model, apiKey, chain.model_snapshot, combined);
      const wordCount = countWords(result.text);
      attempts.push({ attempt: attemptNum, text: result.text, word_count: wordCount });

      if (!missesTarget(wordCount, target, retryThresholdFraction)) {
        return {
          generation: genIndex,
          text: result.text,
          target_word_count: target,
          actual_word_count: wordCount,
          status: "done",
          attempts,
          raw_response: result.text,
          error: null,
          timestamp: new Date().toISOString(),
        };
      }
    }

    const last = attempts[attempts.length - 1];
    return {
      ...chain.generations[genIndex],
      status: "error",
      attempts,
      error: `Never reached the target word count (${target} ±${Math.round(retryThresholdFraction * 100)}%) in ${MAX_REWRITE_ATTEMPTS} attempts. Last attempt: ${last.word_count} words.`,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof ModelCallError ? err.message : "Unknown error.";
    return {
      ...chain.generations[genIndex],
      status: "error",
      attempts,
      error: message,
      timestamp: new Date().toISOString(),
    };
  }
}
