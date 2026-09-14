import ExcelJS from "exceljs";
import { RewritingChain } from "@/lib/types";
import { toCsv } from "@/lib/csv";

// Column order for buildRewritingAsVignettesWorkbook's "Vignettes" sheet —
// the first 10 are exactly lib/vignettes.ts's REQUIRED_HEADERS, in that
// order, so the file re-uploads through the Attribution/Rewriting modules'
// own parser unmodified. The trailing two are additive/informational —
// parseVignetteWorkbook looks columns up by header name, so extra columns
// it doesn't recognize are silently ignored on re-upload — added so a
// person can tell which chain/generation a row came from without having
// to parse it back out of vignette_id.
const AS_VIGNETTES_HEADERS = [
  "vignette_id",
  "domain",
  "valence",
  "scenario_number",
  "order_variant",
  "actor_first_name",
  "actor_second_name",
  "female_name",
  "male_name",
  "vignette_text",
  "rewrite_generation",
  "rewrite_model",
] as const;

// The core columns exactly match the DMP schema in §4 Output. `attempt_count`
// and `attempt_word_counts` are additive trailing columns — the confirmed
// protocol is retry-until-compliant (re-reading the same source text each
// time, not the failed attempt), so every attempt's word count is compliance
// data worth keeping, not just a single first-vs-retry pair. Full per-attempt
// text lives in `attempts_json` rather than as one column per attempt, since
// the number of attempts varies per generation.
const LONG_HEADERS = [
  "chain_id",
  "vignette_id",
  "domain",
  "valence",
  "scenario_number",
  "order_variant",
  "model",
  "model_snapshot",
  "generation",
  "text",
  "target_word_count",
  "actual_word_count",
  "timestamp",
  "attempt_count",
  "attempt_word_counts",
  "attempts_json",
] as const;

/** Long-format CSV (§4 Output). One row per generation (0-5, 0=seed) per chain. */
export function buildRewritingLongCsv(chains: RewritingChain[]): string {
  const rows: (string | number | null)[][] = [];
  for (const chain of chains) {
    for (const gen of chain.generations) {
      rows.push([
        chain.id,
        chain.vignette_id,
        chain.domain,
        chain.valence,
        chain.scenario_number,
        chain.order_variant,
        chain.model,
        chain.model_snapshot,
        gen.generation,
        gen.text,
        gen.target_word_count,
        gen.actual_word_count,
        gen.timestamp,
        gen.attempts.length,
        gen.attempts.map((a) => a.word_count).join(";"),
        gen.attempts.length > 0 ? JSON.stringify(gen.attempts) : null,
      ]);
    }
  }
  return toCsv([...LONG_HEADERS], rows);
}

const WIDE_HEADERS = [
  "chain_id",
  "vignette_id",
  "model",
  "Gen0 (seed)",
  "Gen1",
  "Gen2",
  "Gen3",
  "Gen4",
  "Gen5",
] as const;

/** Wide-format workbook, one row per chain_id, matching example_output_formats.xlsx (§4 Output). */
export function buildRewritingWideWorkbook(chains: RewritingChain[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Rewriting (wide view)");
  sheet.addRow([...WIDE_HEADERS]);
  sheet.getRow(1).font = { bold: true };

  for (const chain of chains) {
    sheet.addRow([
      chain.id,
      chain.vignette_id,
      chain.model,
      ...chain.generations.map((g) => g.text),
    ]);
  }

  sheet.columns.forEach((col, i) => {
    col.width = i < 3 ? 16 : 50;
  });

  return workbook;
}

/**
 * "Export as vignette upload" — turns every completed generation across
 * this run's chains back into a Vignettes-shaped workbook (one "Vignettes"
 * sheet, lib/vignettes.ts's exact required headers) so it can be re-uploaded
 * straight into either module to run Attribution on the rewritten text.
 *
 * Two things this has to get right, both because Attribution's bias math
 * (lib/export/attribution.ts's computeRowsAndPairs) groups rows by
 * domain+valence+scenario_number and expects to find exactly one A row and
 * one B row per group — silently taking just the first of each if there are
 * more:
 *
 * 1. Generation 0 (the seed) is identical text in both models' chains for
 *    the same vignette_id — emitted once, not duplicated per model, tracked
 *    via `seenGenZero`.
 * 2. Every other generation is model-specific, and every (original
 *    scenario, generation, model) combination needs its own scenario_number
 *    so it stays its own isolated, correctly-paired A/B slice rather than
 *    colliding with every other generation/model of the same original
 *    scenario. Encoded as `original*1000 + generation*10 + modelSlot`
 *    (modelSlot 0 = generation 0's shared/model-agnostic row, 1 = GPT, 2 =
 *    Gemini) — generation*10+modelSlot never exceeds 52, so this can't
 *    collide across different original scenario numbers. vignette_id gets
 *    the same info appended in readable form (e.g. "...-Gen3-GPT") instead.
 *
 * A generation that never finished (status other than "done" — an error,
 * or a chain that was cancelled partway through) is skipped rather than
 * exported with blank/incomplete text; whatever generations *did* finish
 * for that chain are still included.
 */
export function buildRewritingAsVignettesWorkbook(chains: RewritingChain[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Vignettes");
  sheet.addRow([...AS_VIGNETTES_HEADERS]);
  sheet.getRow(1).font = { bold: true };

  const modelSlot: Record<RewritingChain["model"], number> = { GPT: 1, Gemini: 2 };
  const seenGenZero = new Set<string>();

  for (const chain of chains) {
    for (const gen of chain.generations) {
      if (gen.status !== "done" || !gen.text) continue;

      const isSeed = gen.generation === 0;
      if (isSeed) {
        if (seenGenZero.has(chain.vignette_id)) continue;
        seenGenZero.add(chain.vignette_id);
      }

      const slot = isSeed ? 0 : modelSlot[chain.model];
      const scenario_number = chain.scenario_number * 1000 + gen.generation * 10 + slot;
      const vignette_id = isSeed
        ? `${chain.vignette_id}-Gen0`
        : `${chain.vignette_id}-Gen${gen.generation}-${chain.model}`;

      sheet.addRow([
        vignette_id,
        chain.domain,
        chain.valence,
        scenario_number,
        chain.order_variant,
        chain.actor_first_name,
        chain.actor_second_name,
        chain.female_name,
        chain.male_name,
        gen.text,
        gen.generation,
        isSeed ? "" : chain.model,
      ]);
    }
  }

  sheet.columns.forEach((col, i) => {
    col.width = i === 9 ? 60 : 16; // vignette_text (index 9) wide, everything else compact
  });

  return workbook;
}
