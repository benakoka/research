// Shared data model for the AI-only transmission chain pilot tool.
// See build spec §2-6 for the source of truth on every field here.

export type ModelProvider = "GPT" | "Gemini";

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. 0/blank = don't estimate cost for this model. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
}

export interface Settings {
  // API keys — stored server-side only, never echoed back in full (see api/settings masking).
  openaiApiKey: string;
  geminiApiKey: string;

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

  // Rough cost-visibility pricing. Optional / blank by default (§7: no snapshot-tied
  // pricing should be hardcoded, and pricing shifts independently of snapshots anyway).
  gptPricing: ModelPricing;
  geminiPricing: ModelPricing;
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
  openaiApiKey: "",
  geminiApiKey: "",
  gptModelSnapshot: "",
  geminiModelSnapshot: "",
  attributionPromptTemplate: DEFAULT_ATTRIBUTION_PROMPT,
  rewritingPromptTemplate: DEFAULT_REWRITING_PROMPT,
  defaultRepCount: 1,
  defaultWordCountTargets: [180, 140, 100, 70, 45],
  retryThresholdFraction: 0.25,
  gptPricing: { inputPerMillion: 0, outputPerMillion: 0 },
  geminiPricing: { inputPerMillion: 0, outputPerMillion: 0 },
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
  id: string;
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
  vignetteSetId: string;
  createdAt: string;
  promptTemplate: string;
  repCount: number;
  gptModelSnapshot: string;
  geminiModelSnapshot: string;
  cellIds: string[];
  status: "pending" | "running" | "done";
}

// ---------------------------------------------------------------------------
// Rewriting module (§4)
// ---------------------------------------------------------------------------

export interface RewritingGeneration {
  generation: number; // 0-5, 0 = seed
  text: string;
  target_word_count: number | null; // null for generation 0 (seed)
  actual_word_count: number;
  status: CellStatus;
  retried: boolean;
  first_attempt_text: string | null;
  first_attempt_word_count: number | null;
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
  vignetteSetId: string;
  createdAt: string;
  promptTemplate: string;
  gptModelSnapshot: string;
  geminiModelSnapshot: string;
  retryThresholdFraction: number;
  chainIds: string[];
  status: "pending" | "running" | "done";
}

// ---------------------------------------------------------------------------
// Cost visibility (§5)
// ---------------------------------------------------------------------------

export interface UsageCounters {
  calls: Record<ModelProvider, number>;
  inputTokens: Record<ModelProvider, number>;
  outputTokens: Record<ModelProvider, number>;
}

export const EMPTY_USAGE: UsageCounters = {
  calls: { GPT: 0, Gemini: 0 },
  inputTokens: { GPT: 0, Gemini: 0 },
  outputTokens: { GPT: 0, Gemini: 0 },
};
