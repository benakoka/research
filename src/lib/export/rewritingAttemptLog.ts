import { ModelProvider, OrderVariant, RewriteAttemptLog, RewriteOutcome, RewritingChain } from "@/lib/types";
import { parseCsv, toCsv } from "@/lib/csv";

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

export class AttemptLogParseError extends Error {}

const VALID_OUTCOMES = new Set<RewriteOutcome>(["success", "refusal", "api_error", "empty", "off_target"]);

/**
 * The exact inverse of buildRewritingAttemptLogCsv — reads back a
 * previously-exported attempt log so a run can be rebuilt from it (see
 * lib/rewriting.ts's applyAttemptLogToChains). Only ever meant to read a
 * file this app itself produced: it validates every required column is
 * present and every outcome value is one it recognizes, and fails loudly
 * rather than guessing on anything else.
 */
export function parseAttemptLogCsv(text: string): RewriteAttemptLog[] {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new AttemptLogParseError("Empty file.");
  }
  const header = rows[0];
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => colIndex.set(h.trim(), i));
  const missing = HEADERS.filter((h) => !colIndex.has(h));
  if (missing.length > 0) {
    throw new AttemptLogParseError(
      `Missing required column(s): ${missing.join(", ")} — is this really an attempt log export from this site?`
    );
  }
  const idx = (h: (typeof HEADERS)[number]) => colIndex.get(h)!;

  const num = (s: string): number => (s.trim() === "" ? NaN : Number(s));
  const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
  const orNull = (s: string): string | null => (s === "" ? null : s);

  const out: RewriteAttemptLog[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (h: (typeof HEADERS)[number]) => row[idx(h)] ?? "";
    const outcome = get("outcome");
    if (!VALID_OUTCOMES.has(outcome as RewriteOutcome)) {
      throw new AttemptLogParseError(`Row ${r + 1}: unrecognized outcome "${outcome}".`);
    }
    out.push({
      attempt_id: get("attempt_id"),
      chain_id: get("chain_id"),
      vignette_id: get("vignette_id"),
      base_vignette_id: get("base_vignette_id"),
      name_race: get("name_race"),
      order_variant: get("order_variant") as OrderVariant,
      model_requested: get("model_requested") as ModelProvider,
      model_returned: orNull(get("model_returned")),
      temperature: num(get("temperature")),
      generation: num(get("generation")),
      attempt_number: num(get("attempt_number")),
      parent_attempt_id: orNull(get("parent_attempt_id")),
      target_words: num(get("target_words")),
      output_words: num(get("output_words")),
      word_diff: num(get("word_diff")),
      outcome: outcome as RewriteOutcome,
      finish_reason: orNull(get("finish_reason")),
      error_message: orNull(get("error_message")),
      timestamp: get("timestamp"),
      input_tokens: numOrNull(get("input_tokens")),
      output_tokens: numOrNull(get("output_tokens")),
      both_names_present: get("both_names_present") === "TRUE",
      output_text: get("output_text"),
      raw_response: orNull(get("raw_response")),
    });
  }
  return out;
}
