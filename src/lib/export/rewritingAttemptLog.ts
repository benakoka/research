import { RewritingChain } from "@/lib/types";
import { toCsv } from "@/lib/csv";

// Exact column order from §3, plus two additive trailing columns
// (output_text, raw_response) — without the actual text a model returned,
// a refusal/api_error row in this log is much harder to diagnose; see
// RewriteAttemptLog's own comment in lib/types.ts.
const HEADERS = [
  "attempt_id",
  "chain_id",
  "vignette_id",
  "base_vignette_id",
  "name_race",
  "order_variant",
  "model_requested",
  "model_returned",
  "temperature",
  "generation",
  "attempt_number",
  "parent_attempt_id",
  "target_words",
  "output_words",
  "word_diff",
  "outcome",
  "finish_reason",
  "error_message",
  "timestamp",
  "input_tokens",
  "output_tokens",
  "both_names_present",
  "output_text",
  "raw_response",
] as const;

function boolStr(b: boolean): string {
  return b ? "TRUE" : "FALSE";
}

/**
 * Full attempt log (§3/§7b) — one row per API call Rewriting ever made,
 * across every chain and generation, kept separately from the successful-
 * output export (buildRewritingLongCsv) so every refusal/error/off-target
 * attempt is visible, not just whichever attempt finally succeeded.
 */
export function buildRewritingAttemptLogCsv(chains: RewritingChain[]): string {
  const rows: (string | number | null)[][] = [];
  for (const chain of chains) {
    for (const a of chain.attemptLog) {
      rows.push([
        a.attempt_id,
        a.chain_id,
        a.vignette_id,
        a.base_vignette_id,
        a.name_race,
        a.order_variant,
        a.model_requested,
        a.model_returned,
        a.temperature,
        a.generation,
        a.attempt_number,
        a.parent_attempt_id,
        a.target_words,
        a.output_words,
        a.word_diff,
        a.outcome,
        a.finish_reason,
        a.error_message,
        a.timestamp,
        a.input_tokens,
        a.output_tokens,
        boolStr(a.both_names_present),
        a.output_text,
        a.raw_response,
      ]);
    }
  }
  return toCsv([...HEADERS], rows);
}
