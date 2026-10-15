import { AttributionCell } from "@/lib/types";
import { toCsv } from "@/lib/csv";

/**
 * "Analysis dataset" CSV — matches the exact column schema of the human
 * comparison study's export (analysis_dataset.csv) so AI rows can sit
 * alongside human ones in the same downstream analysis. Every column here
 * was checked against that real file, not guessed — item_code and
 * order_conflict in particular (see ITEM_CODE_THIRD_LETTER below) came out
 * as exact, verified functions of the other columns once checked against
 * all 877 real rows; the rest were confirmed by direct inspection.
 *
 * Columns with no AI equivalent (human demographics, attention-check
 * values, the always-"NA" position column) are written as "NA", matching
 * that file's own placeholder convention for not-applicable fields — never
 * fabricated.
 */
const HEADERS = [
  "rating_id",
  "rater_id",
  "rater_type",
  "rater_group",
  "source_file",
  "rater_gender",
  "rater_race",
  "rater_age",
  "rater_education",
  "rater_state",
  "rater_comments",
  "attention_check_value",
  "attention_check_export_value",
  "position",
  "generation",
  "domain",
  "valence",
  "scenario_number",
  "order_variant",
  "name_race",
  "vignette_id",
  "text_id",
  "rep_number",
  "raw_scale_value",
  "export_value",
  "item_code",
  "suffix_conflict",
  "order_conflict",
  "male_actor_positive_end",
  "match_status",
  "rated_text",
] as const;

const NA = "NA";

const DOMAIN_INITIAL: Record<string, string> = { leadership: "L", brilliance: "B", rationality: "R" };
const VALENCE_INITIAL: Record<string, string> = { credit: "C", blame: "B" };
const TITLE_CASE_DOMAIN: Record<string, string> = {
  leadership: "Leadership",
  brilliance: "Brilliance",
  rationality: "Rationality",
};
const TITLE_CASE_VALENCE: Record<string, string> = { credit: "Credit", blame: "Blame" };

/**
 * item_code's third character, for the row whose *current* order_variant is
 * "A" — the sibling "B" row always gets the opposite letter (confirmed:
 * every one of the 18 scenario pairs in the reference file does this with
 * zero exceptions). Extracted directly from analysis_dataset.csv's real
 * gen-0 rows rather than derived from a formula, because it isn't one: it
 * reflects each item's *original* order_variant label from before the
 * vignette set's A-is-always-woman-first correction (see the vignette
 * reordering done earlier) — for the 9 scenarios that correction actually
 * flipped, the "A" row's historical letter is "B" (and vice versa); for the
 * other 9, nothing changed, so the letter still matches "A". Hardcoding the
 * real values here keeps every AI row's item_code exactly joinable against
 * the corresponding human row's, which is the entire point of this column.
 */
const ITEM_CODE_A_ROW_THIRD_LETTER: Record<string, string> = {
  "brilliance::blame::1": "B",
  "brilliance::blame::2": "A",
  "brilliance::blame::3": "A",
  "brilliance::credit::1": "A",
  "brilliance::credit::2": "B",
  "brilliance::credit::3": "A",
  "leadership::blame::1": "B",
  "leadership::blame::2": "A",
  "leadership::blame::3": "B",
  "leadership::credit::1": "A",
  "leadership::credit::2": "B",
  "leadership::credit::3": "A",
  "rationality::blame::1": "B",
  "rationality::blame::2": "A",
  "rationality::blame::3": "B",
  "rationality::credit::1": "A",
  "rationality::credit::2": "B",
  "rationality::credit::3": "A",
};

function boolStr(b: boolean): string {
  return b ? "TRUE" : "FALSE";
}

/**
 * item_code = {domain letter}{valence letter}{the letter above}{scenario
 * number}{M/F for which gender is at the scale's +50 end}. Returns null for
 * a scenario this app doesn't have a historical-letter entry for (shouldn't
 * happen for the 18 confirmed scenarios, but this is real research data —
 * fail into a visible "N/A" rather than a wrong-looking code).
 */
function computeItemCode(
  domain: string,
  valence: string,
  scenarioNumber: number,
  orderVariant: "A" | "B",
  maleAtPositiveEnd: boolean
): string | null {
  const key = `${domain}::${valence}::${scenarioNumber}`;
  const aRowLetter = ITEM_CODE_A_ROW_THIRD_LETTER[key];
  if (!aRowLetter) return null;
  const thirdLetter = orderVariant === "A" ? aRowLetter : aRowLetter === "A" ? "B" : "A";
  const domainInitial = DOMAIN_INITIAL[domain];
  const valenceInitial = VALENCE_INITIAL[valence];
  if (!domainInitial || !valenceInitial) return null;
  return `${domainInitial}${valenceInitial}${thirdLetter}${scenarioNumber}${maleAtPositiveEnd ? "M" : "F"}`;
}

// Matches lib/export/rewriting.ts's buildRewritingAsVignettesWorkbook
// output exactly: "{baseVignetteId}-Gen0" for the shared seed, or
// "{baseVignetteId}-Gen{N}-{Model}" for a model-specific rewrite. Stripped
// back off here so `vignette_id` in this export always holds the clean
// original id, same as analysis_dataset.csv's own convention (it never
// varies vignette_id by generation either) — the generation/rewrite-model
// detail that would otherwise be lost goes into `text_id` instead.
const GENERATION_SUFFIX = /^(.+)-Gen(\d+)(?:-(GPT|Gemini))?$/;

function parseGenerationSuffix(vignetteId: string): { baseId: string; generation: number; rewriteModel: string | null } {
  const match = vignetteId.match(GENERATION_SUFFIX);
  if (!match) return { baseId: vignetteId, generation: 0, rewriteModel: null };
  return { baseId: match[1], generation: Number(match[2]), rewriteModel: match[3] ?? null };
}

// cell.scenario_number is NOT always the original 1/2/3 — a vignette set
// that went through the Rewriting module's "export as vignette upload"
// re-encodes it as original*1000 + generation*10 + modelSlot (see
// lib/export/rewriting.ts) so Attribution's own pairing math keeps every
// generation/model combination correctly isolated. That encoding is purely
// internal to Attribution's math; this export needs the real scenario
// number, both for its own scenario_number column and for the item_code
// lookup table below (keyed on 1/2/3 — every cell from a rewriting-chain
// export was otherwise falling through to "no match", which is why every
// item_code/text_id/rating_id came out "...NA" for that data). Read it
// from the vignette_id text itself instead, which always has the real
// number in it regardless of what scenario_number was re-encoded to —
// "Scenario 2" in "Rationality-Credit-Scenario 2-A", say.
function trueScenarioNumber(baseId: string, fallback: number): number {
  const match = baseId.match(/Scenario\s+(\d+)/i);
  return match ? Number(match[1]) : fallback;
}

/**
 * Builds the analysis-dataset-format CSV from this run's cells. Only cells
 * that actually finished with a real rating go in — raw_scale_value has to
 * be a real number, so a pending/errored cell has nothing valid to put
 * there.
 */
export function buildAttributionAnalysisCsv(cells: AttributionCell[]): string {
  const rows: (string | number | null)[][] = [];

  for (const cell of cells) {
    if (cell.status !== "done" || cell.rating === null) continue;

    const { baseId, generation, rewriteModel } = parseGenerationSuffix(cell.vignette_id);
    const scenarioNumber = trueScenarioNumber(baseId, cell.scenario_number);
    const raterId = `${cell.model}-rep${cell.rep}`;
    const maleAtPositiveEnd = cell.scale_direction === "flipped";
    const itemCode = computeItemCode(cell.domain, cell.valence, scenarioNumber, cell.order_variant, maleAtPositiveEnd);
    const orderConflict = itemCode !== null && cell.order_variant !== itemCode[2];

    // See the matching comment on computeItemCode: a scenario this table
    // doesn't cover can't get a real item_code, so rating_id/order_conflict
    // fall back to clearly-missing values rather than a confident-looking
    // guess.
    const ratingIdSuffix = generation > 0 ? `_Gen${generation}` : "";
    const ratingId = itemCode ? `${raterId}${ratingIdSuffix}_${itemCode}` : NA;

    // One consistent shape for every row, generation 0 included — always
    // rater:Gen{N}[-{rewriteModel}]:{item_code}. Earlier this used bare
    // vignette_id for generation 0 and switched to a different shape
    // otherwise, which both looked inconsistent *and* was a real bug: that
    // other shape carried no vignette-identifying part at all, so two
    // different stories rated by the same rep at the same generation
    // produced the exact same text_id. Splicing item_code in (already
    // computed above) fixes both at once — it's what actually identifies
    // which text this is.
    const textId = `${raterId}:Gen${generation}${rewriteModel ? `-${rewriteModel}` : ""}:${itemCode ?? NA}`;

    rows.push([
      ratingId,
      raterId,
      "ai",
      cell.model, // rater_group: repurposed to carry which model, in place of the human file's Men/Women
      NA, // source_file — no per-batch file splitting for AI runs
      cell.model, // rater_gender: repurposed the same way, since that's literally the column the human file uses to say who rated this
      NA, // rater_race
      NA, // rater_age
      NA, // rater_education
      NA, // rater_state
      NA, // rater_comments
      NA, // attention_check_value
      NA, // attention_check_export_value
      NA, // position — always NA in the reference file too
      generation,
      TITLE_CASE_DOMAIN[cell.domain] ?? cell.domain,
      TITLE_CASE_VALENCE[cell.valence] ?? cell.valence,
      scenarioNumber,
      cell.order_variant,
      cell.name_race || NA,
      baseId,
      textId,
      cell.rep,
      cell.rating,
      cell.rating + 50,
      itemCode ?? NA,
      "FALSE", // suffix_conflict — always FALSE in the reference file
      itemCode ? boolStr(orderConflict) : NA,
      boolStr(maleAtPositiveEnd),
      generation === 0 ? "exact_seed" : "rewrite_by_slot",
      cell.vignette_text,
    ]);
  }

  return toCsv([...HEADERS], rows);
}
