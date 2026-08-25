// Shared data model for the AI-only transmission chain pilot tool.
// See build spec §2-6 for the source of truth on every field here.

export type ModelProvider = "GPT" | "Gemini";

export interface Settings {
  // Model snapshot strings, e.g. "gpt-5.2", "gemini-3-pro". Free text, no hardcoded fallback.
  gptModelSnapshot: string;
  geminiModelSnapshot: string;

  // §3 rating prompt template. Must contain [FEMALE NAME] and [MALE NAME] placeholders.
  attributionPromptTemplate: string;

  // §4 rewriting prompt template. Must contain [TARGET WORD COUNT] placeholder.
  rewritingPromptTemplate: string;

  // Default rep count for attribution ratings. Confirmed default: 1.
  defaultRepCount: number;

  // Default per-generation word-count targets for rewriting, generations 1-5 in order.
  defaultWordCountTargets: [number, number, number, number, number];

  // Retry threshold for rewriting word-count compliance, as a fraction (0.25 = 25%).
  // Adjustable constant per §4 — not meant to be a hardcoded magic number.
  retryThresholdFraction: number;
}

export const DEFAULT_ATTRIBUTION_PROMPT = `Imagine you are the boss of both employees. Which person is most deserving of being
rewarded/reprimanded for their actions? Provide a rating corresponding to +50 for
[FEMALE NAME] being fully responsible to -50 for [MALE NAME] being fully responsible.
One employee must be granted more responsibility than the other; you cannot select 0.
Respond with only the number.`;

export const DEFAULT_REWRITING_PROMPT = `Rewrite the following short story in your own words. Conserve as much detail and meaning
as you can, while reducing the story to approximately [TARGET WORD COUNT] words. Keep
both characters's names exactly as they appear in the original. Return only the
rewritten passage.`;

export const DEFAULT_SETTINGS: Settings = {
  gptModelSnapshot: "",
  geminiModelSnapshot: "",
  attributionPromptTemplate: DEFAULT_ATTRIBUTION_PROMPT,
  rewritingPromptTemplate: DEFAULT_REWRITING_PROMPT,
  defaultRepCount: 1,
  defaultWordCountTargets: [55, 50, 45, 40, 35],
  retryThresholdFraction: 0.1,
};

// ---------------------------------------------------------------------------
// Vignette data (§3 input / §6 template)
// ---------------------------------------------------------------------------

export type Domain = "leadership" | "brilliance" | "rationality";
export type Valence = "credit" | "blame";
export type OrderVariant = "A" | "B";

export interface VignetteRow {
  vignette_id: string;
  domain: Domain;
  valence: Valence;
  scenario_number: number;
  order_variant: OrderVariant;
  actor_first_name: string;
  actor_second_name: string;
  female_name: string;
  male_name: string;
  vignette_text: string;
}

export interface VignetteSet {
  filename: string;
  uploadedAt: string;
  rows: VignetteRow[];
}

// ---------------------------------------------------------------------------
// Attribution module (§3)
// ---------------------------------------------------------------------------

export type ScaleDirection = "as_written" | "flipped";
export type CellStatus = "pending" | "running" | "done" | "error";

export interface AttributionCell {
  id: string; // `${vignette_id}::${scale_direction}::${model}::rep${n}`
  vignette_id: string;
  domain: Domain;
  valence: Valence;
  scenario_number: number;
  order_variant: OrderVariant;
  female_name: string;
  male_name: string;
  // Denormalized onto the cell (rather than looked up server-side by
  // vignette_id) because there's no server-side store to look it up from —
  // every API call is a stateless transform over exactly what the client
  // sends (see lib/apiKeys.ts / api routes under /api/attribution).
  vignette_text: string;
  scale_direction: ScaleDirection;
  plus50_name: string;
  minus50_name: string;
  model: ModelProvider;
  model_snapshot: string;
  rep: number;
  status: CellStatus;
  rating: number | null;
  raw_response: string | null;
  parse_error: string | null;
  error: string | null;
  timestamp: string | null;
}

export interface AttributionRun {
  id: string;
  createdAt: string;
  promptTemplate: string;
  repCount: number;
  gptModelSnapshot: string;
  geminiModelSnapshot: string;
  vignetteSetFilename: string;
  // Inline, not a list of ids into a server store — the run *is* its cells.
  // Persisted client-side (localStorage) only; nothing here ever reaches a
  // database, so "download the output" is the only durable copy.
  cells: AttributionCell[];
  // "cancelled": the user stopped the run mid-flight (Cancel button). Cells
  // that hadn't been sent yet stay "pending" — cancelling doesn't discard
  // anything already completed, and the run can still be exported as-is.
  // Distinct from "pending"/"running" specifically so a page refresh doesn't
  // auto-resume a run the user deliberately stopped.
  status: "pending" | "running" | "done" | "cancelled";
}

// ---------------------------------------------------------------------------
// Rewriting module (§4)
// ---------------------------------------------------------------------------

// One model call at one rewrite attempt for a generation. Confirmed protocol
// (§4): a miss retries by re-reading the exact same source text again (the
// prior generation's finished output) — never the failed attempt itself —
// until it complies. Every attempt is kept as compliance data, not just the
// first one.
export interface RewriteAttempt {
  attempt: number; // 1-based
  text: string;
  word_count: number;
}

export interface RewritingGeneration {
  generation: number; // 0-5, 0 = seed
  text: string; // final, compliant text (the last attempt) once status is "done"
  target_word_count: number | null; // null for generation 0 (seed)
  actual_word_count: number;
  status: CellStatus;
  attempts: RewriteAttempt[]; // every attempt made; length 1 = compliant on the first try
  raw_response: string | null;
  error: string | null;
  timestamp: string | null;
}

export interface RewritingChain {
  id: string; // stable chain_id, assigned at creation, never reused/regenerated
  vignette_id: string;
  domain: Domain;
  valence: Valence;
  scenario_number: number;
  order_variant: OrderVariant;
  model: ModelProvider;
  model_snapshot: string;
  wordCountTargets: [number, number, number, number, number];
  generations: RewritingGeneration[]; // length 6, index 0 = seed
  status: CellStatus;
}

export interface RewritingRun {
  id: string;
  createdAt: string;
  promptTemplate: string;
  gptModelSnapshot: string;
  geminiModelSnapshot: string;
  retryThresholdFraction: number;
  vignetteSetFilename: string;
  // Inline, same reasoning as AttributionRun.cells above.
  chains: RewritingChain[];
  // See AttributionRun.status — same "cancelled" meaning here.
  status: "pending" | "running" | "done" | "cancelled";
}
