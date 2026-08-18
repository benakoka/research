// Server-only: pulls in lib/models (fetch calls to provider APIs) and
// lib/apiKeys (server env-var secrets). Only import from API routes — see
// lib/rewriting.ts for the pure, client-safe half (building chains,
// figuring out what's runnable next).
import { RewritingChain, RewritingGeneration } from "./types";
import { callModel, ModelCallError } from "./models";
import { getApiKey } from "./apiKeys";
import { buildRewritingPrompt } from "./rewriting";
import { countWords, missesTarget } from "./wordcount";

export interface GenerationExecutionResult {
  generation: RewritingGeneration;
  usage: { inputTokens: number; outputTokens: number } | null; // null when the call errored
}

/** Executes one generation: builds the prompt from the previous generation's output, calls the model, retries once on a large word-count miss (§4). */
export async function executeGeneration(
  promptTemplate: string,
  retryThresholdFraction: number,
  chain: RewritingChain,
  genIndex: number
): Promise<GenerationExecutionResult> {
  const apiKey = getApiKey(chain.model);
  const target = chain.wordCountTargets[genIndex - 1];
  const inputText = chain.generations[genIndex - 1].text;
  const prompt = buildRewritingPrompt(promptTemplate, target);
  const combined = `${prompt}\n\n${inputText}`;

  try {
    const first = await callModel(chain.model, apiKey, chain.model_snapshot, combined);
    const firstWordCount = countWords(first.text);

    if (missesTarget(firstWordCount, target, retryThresholdFraction)) {
      // Retry once automatically on a large miss — keep the first attempt's
      // data rather than discarding it, it's compliance data too (§4).
      const retry = await callModel(chain.model, apiKey, chain.model_snapshot, combined);
      const retryWordCount = countWords(retry.text);
      return {
        generation: {
          generation: genIndex,
          text: retry.text,
          target_word_count: target,
          actual_word_count: retryWordCount,
          status: "done",
          retried: true,
          first_attempt_text: first.text,
          first_attempt_word_count: firstWordCount,
          raw_response: retry.text,
          error: null,
          timestamp: new Date().toISOString(),
        },
        usage: {
          inputTokens: first.usage.inputTokens + retry.usage.inputTokens,
          outputTokens: first.usage.outputTokens + retry.usage.outputTokens,
        },
      };
    }

    return {
      generation: {
        generation: genIndex,
        text: first.text,
        target_word_count: target,
        actual_word_count: firstWordCount,
        status: "done",
        retried: false,
        first_attempt_text: null,
        first_attempt_word_count: null,
        raw_response: first.text,
        error: null,
        timestamp: new Date().toISOString(),
      },
      usage: first.usage,
    };
  } catch (err) {
    const message = err instanceof ModelCallError ? err.message : "Unknown error.";
    return {
      generation: {
        ...chain.generations[genIndex],
        status: "error",
        error: message,
        timestamp: new Date().toISOString(),
      },
      usage: null,
    };
  }
}
