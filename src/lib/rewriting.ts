// Pure logic only — no server secrets, no fetch calls. Safe to import from
// client components as well as API routes. The model-calling half of this
// lives in lib/rewritingExec.ts, which is server-only.
import {
  RewritingChain,
  RewritingGeneration,
  RewriteAttemptLog,
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

/**
 * Builds the chains for a run: rows × (1 or 2 models, per enabledModels),
 * each starting from the row's own seed text (§4). A model with its flag
 * off gets no chains at all, not chains that are filtered out afterward.
 */
export function buildRewritingChains(
  rows: VignetteRow[],
  wordCountTargets: [number, number, number, number, number],
  gptModelSnapshot: string,
  geminiModelSnapshot: string,
  enabledModels: { GPT: boolean; Gemini: boolean } = { GPT: true, Gemini: true }
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
  const activeModels = MODELS.filter((m) => enabledModels[m]);
  const now = new Date().toISOString();
  const chains: RewritingChain[] = [];
  let counter = 1;
  for (const row of rows) {
    for (const model of activeModels) {
      const chainId = `CHAIN-${String(counter).padStart(4, "0")}`;
      counter++;
      chains.push({
        id: chainId,
        vignette_id: row.vignette_id,
        base_vignette_id: row.base_vignette_id,
        scenario: row.scenario,
        word_count: row.word_count,
        domain: row.domain,
        valence: row.valence,
        scenario_number: row.scenario_number,
        order_variant: row.order_variant,
        actor_first_name: row.actor_first_name,
        actor_second_name: row.actor_second_name,
        female_name: row.female_name,
        male_name: row.male_name,
        name_race: row.name_race,
        model,
        model_snapshot: snapshotFor[model],
        wordCountTargets: targets,
        generations: [
          seedGeneration(row, now),
          ...targets.map((t, i) => pendingGeneration(i + 1, t)),
        ],
        status: "pending",
        attemptLog: [],
        failedAtGeneration: null,
      });
    }
  }
  return chains;
}

/**
 * Recovery path for when a run's localStorage state was lost (browser
 * storage cleared/reset) but an attempt-log CSV export from it still
 * exists. Rebuilds a run's completed-so-far progress from that log rather
 * than starting over from scratch.
 *
 * Takes freshly-built chains (buildRewritingChains, over the same
 * vignette rows/settings as the original run) and, for each one, marks
 * every generation "done" that the log shows a successful attempt for —
 * stopping at the first generation that doesn't have one, so a chain's
 * strict 1→2→3→4→5 order is never violated even if the log were somehow
 * missing an earlier generation's success. Everything from that point on
 * is left exactly as buildRewritingChains made it ("pending"), ready for
 * the normal run engine to actually produce.
 *
 * Matched by vignette_id + model, not chain_id — chain_id is only ever a
 * label assigned by build order (buildRewritingChains's own counter), not
 * a stable identity, so it can't be trusted to still mean the same chain
 * after a rebuild (e.g. a different row selection would shift every
 * chain_id). vignette_id is unique per uploaded row and never changes, so
 * it's the only reliable key across a rebuild.
 */
export function applyAttemptLogToChains(
  chains: RewritingChain[],
  attemptLog: RewriteAttemptLog[]
): RewritingChain[] {
  const successByKey = new Map<string, RewriteAttemptLog>();
  const logByVignetteModel = new Map<string, RewriteAttemptLog[]>();
  for (const a of attemptLog) {
    const vmKey = `${a.vignette_id}::${a.model_requested}`;
    const arr = logByVignetteModel.get(vmKey);
    if (arr) arr.push(a);
    else logByVignetteModel.set(vmKey, [a]);

    if (a.outcome !== "success") continue;
    const key = `${vmKey}::${a.generation}`;
    const existing = successByKey.get(key);
    // Last one wins if the log somehow has more than one success logged
    // for the same slot (e.g. a manual retry happened after an earlier
    // export was taken, then both were merged together).
    if (!existing || a.timestamp >= existing.timestamp) successByKey.set(key, a);
  }

  return chains.map((chain) => {
    const generations = chain.generations.map((g) => ({ ...g }));
    for (let gen = 1; gen <= 5; gen++) {
      if (generations[gen - 1].status !== "done") break;
      const hit = successByKey.get(`${chain.vignette_id}::${chain.model}::${gen}`);
      if (!hit) break;
      generations[gen] = {
        generation: gen,
        text: hit.output_text,
        target_word_count: hit.target_words,
        actual_word_count: hit.output_words,
        status: "done",
        attempts: [],
        raw_response: hit.raw_response,
        error: null,
        timestamp: hit.timestamp,
      };
    }
    return {
      ...chain,
      generations,
      // Re-attached under this (possibly new) chain.id — note that these
      // imported rows still carry whatever chain_id they were logged
      // under originally, which may now differ from this chain's own id.
      // That's cosmetic only (chain_id is a label, not what anything here
      // keys on) — harmless for a combined export going forward.
      attemptLog: logByVignetteModel.get(`${chain.vignette_id}::${chain.model}`) ?? [],
      failedAtGeneration: null,
    };
  });
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
