// Pure logic only — no server secrets, no fetch calls. Safe to import from
// client components as well as API routes. The model-calling half of this
// lives in lib/rewritingExec.ts, which is server-only.
import {
  RewritingChain,
  RewritingGeneration,
  VignetteRow,
  ModelProvider,
} from "./types";
import { countWords } from "./wordcount";

const MODELS: ModelProvider[] = ["GPT", "Gemini"];

export function buildRewritingPrompt(template: string, targetWordCount: number): string {
  return template.replaceAll("[TARGET WORD COUNT]", String(targetWordCount));
}

function seedGeneration(row: VignetteRow, timestamp: string): RewritingGeneration {
  return {
    generation: 0,
    text: row.vignette_text,
    target_word_count: null,
    actual_word_count: countWords(row.vignette_text),
    status: "done",
    retried: false,
    first_attempt_text: null,
    first_attempt_word_count: null,
    raw_response: null,
    error: null,
    timestamp,
  };
}

function pendingGeneration(generation: number, target: number): RewritingGeneration {
  return {
    generation,
    text: "",
    target_word_count: target,
    actual_word_count: 0,
    status: "pending",
    retried: false,
    first_attempt_text: null,
    first_attempt_word_count: null,
    raw_response: null,
    error: null,
    timestamp: null,
  };
}

/** Builds the chains for a run: rows × 2 models, each starting from the row's own seed text (§4). */
export function buildRewritingChains(
  rows: VignetteRow[],
  wordCountTargets: [number, number, number, number, number],
  gptModelSnapshot: string,
  geminiModelSnapshot: string
): RewritingChain[] {
  const snapshotFor: Record<ModelProvider, string> = {
    GPT: gptModelSnapshot,
    Gemini: geminiModelSnapshot,
  };
  const now = new Date().toISOString();
  const chains: RewritingChain[] = [];
  let counter = 1;
  for (const row of rows) {
    for (const model of MODELS) {
      const chainId = `CHAIN-${String(counter).padStart(4, "0")}`;
      counter++;
      chains.push({
        id: chainId,
        vignette_id: row.vignette_id,
        domain: row.domain,
        valence: row.valence,
        scenario_number: row.scenario_number,
        order_variant: row.order_variant,
        model,
        model_snapshot: snapshotFor[model],
        wordCountTargets,
        generations: [
          seedGeneration(row, now),
          ...wordCountTargets.map((t, i) => pendingGeneration(i + 1, t)),
        ],
        status: "pending",
      });
    }
  }
  return chains;
}

/** Index of the next generation (1-5) ready to run, or null if the chain is done/blocked. */
export function nextRunnableGenerationIndex(chain: RewritingChain): number | null {
  for (let i = 1; i <= 5; i++) {
    const gen = chain.generations[i];
    if (gen.status === "done") continue;
    if (gen.status === "pending" && chain.generations[i - 1].status === "done") {
      return i;
    }
    return null; // blocked on a running/errored earlier generation
  }
  return null; // all done
}
