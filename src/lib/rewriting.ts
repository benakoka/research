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
    attempts: [],
    raw_response: null,
    error: null,
    timestamp,
  };
}

/** A fresh, not-yet-run generation slot. Exported so callers (e.g. the
 * Rewriting page's retry flow) can reset a generation back to this exact
 * shape when invalidating it, rather than hand-rolling the same object. */
export function pendingGeneration(generation: number, target: number): RewritingGeneration {
  return {
    generation,
    text: "",
    target_word_count: target,
    actual_word_count: 0,
    status: "pending",
    attempts: [],
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
  // Defense in depth: the Settings UI already clamps these, but a target of
  // 0/negative/fractional words would either build a chain that can never
  // comply or silently misbehave downstream (e.g. missesTarget's
  // divide-by-target math) — never let one reach the run itself.
  const targets = wordCountTargets.map((t) => Math.max(1, Math.round(t) || 1)) as [
    number,
    number,
    number,
    number,
    number,
  ];
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
        wordCountTargets: targets,
        generations: [
          seedGeneration(row, now),
          ...targets.map((t, i) => pendingGeneration(i + 1, t)),
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
