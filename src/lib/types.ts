// Shared data model for the AI-only transmission chain pilot tool.
// See build spec §2-6 for the source of truth on every field here.

export type ModelProvider = "GPT" | "Gemini";

export interface Settings {
  // Model snapshot strings, e.g. "gpt-5.2", "gemini-3-pro". Free text, no hardcoded fallback.
  gptModelSnapshot: string;
  geminiModelSnapshot: string;

  // Which models a run actually uses — both Attribution (buildAttributionCells)
  // and Rewriting (buildRewritingChains) skip a model entirely (no cells/
  // chains built for it at all, not just skipped at call time) when its
  // flag here is false, so someone testing/short on budget for one
  // provider can run the other alone. Both false is invalid (nothing to
  // run) — the Attribution/Rewriting pages block starting a run in that
  // case rather than silently building zero cells.
  enabledModels: { GPT: boolean; Gemini: boolean };

  // §3 rating prompt template — the fixed second half of the prompt, sent
  // after a domain/valence-specific opening question (hardcoded, not part
  // of this template — see lib/attribution.ts's DOMAIN_VALENCE_QUESTIONS).
  // Must contain [FEMALE NAME] and [MALE NAME] placeholders.
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

  // Whether the retry threshold above is actually enforced. False means a
  // generation's first attempt is always accepted, regardless of how far it
  // misses its word-count target — no retrying on word count at all.
  retryThresholdEnabled: boolean;

  // Generation parameters sent explicitly to each model's API (§6) —
  // previously neither provider call sent a temperature at all, leaving it
  // at whatever the provider's own default is. Free-form per-model so GPT
  // and Gemini can be tuned independently; no study-mandated default, so
  // these just start at each API's own baseline (1.0).
  gptTemperature: number;
  geminiTemperature: number;

  // Rewriting retry budgets (§5), explicit and adjustable rather than
  // hardcoded — separate from retryThresholdFraction/Enabled above, which
  // governs *word-count* ("off_target") retries only:
  //   - apiErrorRetryLimit: automatic retries (with backoff) on an HTTP/
  //     network/timeout/rate-limit failure.
  //   - refusalEmptyRetryLimit: retries (identical prompt/input, no backoff)
  //     when the model refuses/returns an empty response instead of erroring.
  // Exhausting either budget marks that generation (and the rest of its
  // chain) "error" — see RewritingChain.failedAtGeneration.
  apiErrorRetryLimit: number;
  refusalEmptyRetryLimit: number;
}

// The opening question (§3) now varies by domain/valence — see
// lib/attribution.ts's DOMAIN_VALENCE_QUESTIONS — so this is just the fixed
// second half, sent right after that question.
export const DEFAULT_ATTRIBUTION_PROMPT = `Provide a rating corresponding to +50 for
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
  enabledModels: { GPT: true, Gemini: true },
  attributionPromptTemplate: DEFAULT_ATTRIBUTION_PROMPT,
  rewritingPromptTemplate: DEFAULT_REWRITING_PROMPT,
  defaultRepCount: 1,
  defaultWordCountTargets: [49, 40, 33, 27, 22],
  retryThresholdFraction: 0.1,
  retryThresholdEnabled: true,
  gptTemperature: 1,
  geminiTemperature: 1,
  apiErrorRetryLimit: 5,
  refusalEmptyRetryLimit: 3,
};

// ---------------------------------------------------------------------------
// Vignette data (§3 input / §6 template)
// ---------------------------------------------------------------------------

export type Domain = "leadership" | "brilliance" | "rationality";
export type Valence = "credit" | "blame";
export type OrderVariant = "A" | "B";

export interface VignetteRow {
  vignette_id: string;
  // The 108-row main-study file is 18 base vignettes × 3 name sets × A/B —
  // base_vignette_id is the shared id across all 6 rows of one base
  // vignette (e.g. "Leadership-Credit-Scenario 1"), distinct from
  // vignette_id (unique per row). Required column — every row must have
  // one, used to group a base vignette's name-set/order-variant siblings.
  base_vignette_id: string;
  // Short descriptive label for the scenario (e.g. "consulting pitch") —
  // informational only, carried straight through to every output row.
  scenario: string;
  domain: Domain;
  valence: Valence;
  scenario_number: number;
  order_variant: OrderVariant;
  actor_first_name: string;
  actor_second_name: string;
  female_name: string;
  male_name: string;
  vignette_text: string;
  name_race: string;
  // The seed text's own word count, as declared by the upload — not
  // recomputed/validated against vignette_text, just carried through to
  // every output row (success CSV) as reference metadata.
  word_count: number;
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
  // Carried from VignetteRow.name_race (see its comment) — "" when the
  // upload had no name_race column. Only read by the Attribution
  // analysis-dataset CSV export.
  name_race: string;
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
  // "paused": the user stopped the run mid-flight (Pause button). Cells
  // that hadn't been sent yet stay "pending" — pausing doesn't discard
  // anything already completed (or already pending), and clicking Resume
  // hands the run straight back to driveRun to pick up exactly where it
  // left off. Distinct from "pending"/"running" specifically so a page
  // refresh doesn't auto-resume a run the user deliberately stopped —
  // that still needs an explicit Resume click.
  status: "pending" | "running" | "done" | "paused";
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
  base_vignette_id: string;
  scenario: string;
  word_count: number;
  domain: Domain;
  valence: Valence;
  scenario_number: number;
  order_variant: OrderVariant;
  // Carried straight from the source VignetteRow at chain-build time, same as
  // domain/valence/etc. above. The rewriting prompt itself never needs these
  // (no [FEMALE NAME]/[MALE NAME] slotting like Attribution has — a model
  // rewriting a story is just told to keep both characters' names as-is),
  // but the "export as vignettes" format (lib/export/rewriting.ts) needs
  // them to reconstruct a valid re-uploadable Vignettes row for each
  // generation, and this run's own vignetteSet (browser state, not
  // persisted) doesn't survive a page reload — so this is the only place
  // that data still exists once a run has resumed from localStorage.
  actor_first_name: string;
  actor_second_name: string;
  female_name: string;
  male_name: string;
  name_race: string;
  model: ModelProvider;
  model_snapshot: string;
  wordCountTargets: [number, number, number, number, number];
  generations: RewritingGeneration[]; // length 6, index 0 = seed
  status: CellStatus;
  // Every API call ever made for this chain, across every generation —
  // appended to, never pruned (even a manual per-generation retry keeps the
  // earlier attempts here; this is an audit trail, not current-state).
  // See RewriteAttemptLog below.
  attemptLog: RewriteAttemptLog[];
  // Set to the 1-5 generation index that exhausted its retry budgets
  // (api_error and/or refusal/empty) without ever succeeding — "failed at
  // generation g," per §5. null while the chain hasn't hit that; cleared
  // back to null if a manual retry on that generation succeeds. A failed
  // generation blocks nextRunnableGenerationIndex from ever advancing past
  // it, so the rest of the chain is never silently skipped.
  failedAtGeneration: number | null;
}

// One row per API call Rewriting makes (§3) — logged separately from the
// chain's actual output text (RewritingGeneration.text/attempts), so every
// attempt is visible even when it never produced usable output. parent_
// attempt_id chains an attempt back to the one it's retrying (null for the
// first attempt at a given generation), so the full retry history for one
// generation can be reconstructed even though attempts from unrelated
// chains/generations are interleaved in the flat export.
export type RewriteOutcome = "success" | "refusal" | "api_error" | "empty" | "off_target";

export interface RewriteAttemptLog {
  attempt_id: string;
  chain_id: string;
  vignette_id: string;
  base_vignette_id: string;
  name_race: string;
  order_variant: OrderVariant;
  model_requested: ModelProvider;
  // The model/version string the API itself reports back (OpenAI's `model`,
  // Gemini's `modelVersion`) — null when the call never got a response at
  // all (api_error) to read one from.
  model_returned: string | null;
  temperature: number;
  generation: number; // 1-5 (seed, generation 0, never calls a model)
  attempt_number: number; // 1-based, within this generation's whole retry history
  parent_attempt_id: string | null;
  target_words: number;
  output_words: number; // 0 for api_error/empty
  word_diff: number; // abs(output_words - target_words) — always computed, even with the retry-threshold toggle off
  outcome: RewriteOutcome;
  // The API's own finish/block reason when it returned one (OpenAI
  // finish_reason, Gemini finishReason/promptFeedback.blockReason) — null
  // for api_error (no response to read it from) or if the provider didn't
  // report one.
  finish_reason: string | null;
  error_message: string | null;
  timestamp: string;
  input_tokens: number | null;
  output_tokens: number | null;
  both_names_present: boolean;
  // Additive, beyond the core schema above — kept because a refusal/
  // api_error log entry is far less useful for diagnosing *why* without the
  // actual text the model returned (or the full raw response body).
  output_text: string;
  raw_response: string | null;
}

export interface RewritingRun {
  id: string;
  createdAt: string;
  promptTemplate: string;
  gptModelSnapshot: string;
  geminiModelSnapshot: string;
  retryThresholdFraction: number;
  retryThresholdEnabled: boolean;
  vignetteSetFilename: string;
  // Inline, same reasoning as AttributionRun.cells above.
  chains: RewritingChain[];
  // Which uploaded vignette rows this run actually used — set once at
  // start (lib/rewriting.ts's buildRewritingChains runs only over the
  // selected rows), kept for display/reference. Run controls (§8) let the
  // user pick a subset (e.g. a 6-row dry run) rather than always the whole
  // upload.
  selectedVignetteIds: string[];
  // "paused": the user stopped the run mid-flight (Pause button). Chains
  // that hadn't been sent yet stay "pending" — pausing doesn't discard
  // anything already completed (or already pending), and clicking Resume
  // hands the run straight back to driveRun to pick up exactly where it
  // left off (§8) — including across a page reload, which auto-resumes
  // anything not deliberately paused. Distinct from "pending"/"running" so
  // a refresh doesn't auto-resume a run the user deliberately stopped.
  status: "pending" | "running" | "done" | "paused";
}
