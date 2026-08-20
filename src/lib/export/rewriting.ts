import ExcelJS from "exceljs";
import { RewritingChain } from "@/lib/types";
import { toCsv } from "@/lib/csv";

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
