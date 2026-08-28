import ExcelJS from "exceljs";
import path from "node:path";
import { AttributionCell } from "@/lib/types";

const LONG_HEADERS = [
  "vignette_id",
  "domain",
  "valence",
  "scenario_number",
  "order_variant",
  "female_name",
  "male_name",
  "scale_direction",
  "plus50_name",
  "minus50_name",
  "model",
  "model_snapshot",
  "rep",
  "raw_response",
  "rating",
  "favor_female",
  "timestamp",
] as const;

/**
 * Recodes one response onto a single consistent direction — positive always
 * means this response favored the woman, negative always means it favored
 * the man — by correcting for two independent things the raw `rating`
 * doesn't know about:
 *
 * 1. scale_direction: on an as_written call the prompt's +50 slot holds the
 *    real female's name, but on a flipped call it holds the real male's
 *    name instead (see lib/attribution.ts's slotNames) — so a flipped
 *    rating needs negating just to get onto a "responsibility attributed to
 *    the real female" scale in the first place.
 * 2. valence: +50 responsibility is favorable to her on a credit row (she
 *    gets the reward) but unfavorable on a blame row (she gets the
 *    reprimand) — so blame rows get a second negation on top.
 *
 * Matches the wide export's *_Fav columns exactly (same two corrections,
 * same order), just applied to one raw rating instead of a pre-combined
 * ARating/B_Rating pair. See the "Legend" sheet on the wide export.
 */
function favorFemale(cell: AttributionCell): number | null {
  if (cell.rating === null) return null;
  const femaleResponsibility = cell.scale_direction === "as_written" ? cell.rating : -cell.rating;
  return cell.valence === "blame" ? -femaleResponsibility : femaleResponsibility;
}

/**
 * Long-format raw data, one row per model call — every cell this run
 * produced, matching the DMP schema (§3 Output). Used to be its own
 * downloadable CSV; now lives as a "Raw Data" tab inside the wide XLSX so
 * there's one export file instead of two, but the row shape is unchanged.
 */
function addRawDataSheet(workbook: ExcelJS.Workbook, cells: AttributionCell[]) {
  const sheet = workbook.addWorksheet("Raw Data");
  sheet.addRow([...LONG_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const c of cells) {
    sheet.addRow([
      c.vignette_id,
      c.domain,
      c.valence,
      c.scenario_number,
      c.order_variant,
      c.female_name,
      c.male_name,
      c.scale_direction,
      c.plus50_name,
      c.minus50_name,
      c.model,
      c.model_snapshot,
      c.rep,
      c.raw_response,
      c.rating,
      favorFemale(c),
      c.timestamp,
    ]);
  }

  sheet.columns.forEach((col) => {
    col.width = 16;
  });
}

// The wide export is built by cloning the user-supplied reference workbook
// (originally Revised_Sheet_Format.xlsx) rather than reconstructing its
// formatting from scratch — an earlier from-scratch attempt at this quietly
// diverged from the reference on borders, the Column Mean row's fill, and
// other details. Cloning style objects directly off the real file makes
// "identical formatting" a copy, not something re-derived and hoped to
// match. The template lives in public/ so it's guaranteed to ship in the
// serverless deployment; it was re-saved through openpyxl once before being
// checked in, to flatten Excel's "shared formula" optimization, which
// otherwise makes ExcelJS throw when the sample rows are spliced out — the
// flattened file evaluates to the exact same values, just without that
// internal optimization — and its embedded charts were dropped (unused —
// see the Graphs sheets' handling below).
//
// 2026-08-28: the reference file's own column layout (one Pref-style column
// per metric, already valence-corrected behind the scenes) was split into
// separate Pref (raw, valence-agnostic) and Fav (valence-corrected) columns
// per the professor's request — see buildAttributionWideWorkbook below.
// That changes the column *count*, so unlike the rest of this file's
// history, the template's row 1/2 headers and conditional-formatting ranges
// can no longer be left untouched byte-for-byte — they're rebuilt to the
// new column layout, reusing styles captured from the template by *role*
// (raw/intermediate/final/combined) rather than by literal column letter.
const TEMPLATE_PATH = path.join(
  process.cwd(),
  "public",
  "export-templates",
  "attribution_wide_template.xlsx"
);

const DATA_SHEET_NAME = "Attribution Summarized Data";

type ColumnRole =
  | "plain"
  | "gpt_raw"
  | "gpt_intermediate"
  | "gpt_final"
  | "gem_raw"
  | "gem_intermediate"
  | "gem_final"
  | "combined";

interface ColumnDef {
  letter: string;
  header: string;
  role: ColumnRole;
  width: number;
}

// The full column layout, in sheet order. Pref = raw attribution bias,
// unadjusted for whether the row is a credit or blame story. Fav = the same
// number sign-corrected for valence (blame rows flipped), so it reads on
// one consistent "favors Actor A vs. favors Actor B" scale across both
// credit and blame rows — see the Legend sheet for the exact formulas.
const WIDE_COLUMNS: ColumnDef[] = [
  { letter: "A", header: "vignette_id", role: "plain", width: 31 },
  { letter: "B", header: "domain", role: "plain", width: 15.86 },
  { letter: "C", header: "valence", role: "plain", width: 15.43 },
  { letter: "D", header: "order_variant", role: "plain", width: 14.29 },
  { letter: "E", header: "female_name", role: "plain", width: 15.29 },
  { letter: "F", header: "male_name", role: "plain", width: 13 },
  { letter: "G", header: "vignette_text", role: "plain", width: 22.71 },

  { letter: "H", header: "GPT_ARating", role: "gpt_raw", width: 10 },
  { letter: "I", header: "GPT_A_1stAction_Pref", role: "gpt_intermediate", width: 16 },
  { letter: "J", header: "GPT_A_ActorA_Pref", role: "gpt_intermediate", width: 16 },
  { letter: "K", header: "GPT_B_Rating", role: "gpt_raw", width: 10 },
  { letter: "L", header: "GPT_B_1stAction_Pref", role: "gpt_intermediate", width: 16 },
  { letter: "M", header: "GPT_B_ActorA_Pref", role: "gpt_intermediate", width: 16 },
  { letter: "N", header: "GPTMean_1stAction_Pref", role: "gpt_final", width: 18 },
  { letter: "O", header: "GPTMean_1stAction_Fav", role: "gpt_final", width: 18 },
  { letter: "P", header: "GPTMean_ActorA_Pref", role: "gpt_final", width: 18 },
  { letter: "Q", header: "GPTMean_ActorA_Fav", role: "gpt_final", width: 18 },
  { letter: "R", header: "GPT_Prompt_Pref", role: "gpt_final", width: 15 },
  { letter: "S", header: "GPT_Prompt_Fav", role: "gpt_final", width: 15 },

  { letter: "T", header: "Gem_ARating", role: "gem_raw", width: 10 },
  { letter: "U", header: "Gem_A_1stAction_Pref", role: "gem_intermediate", width: 16 },
  { letter: "V", header: "Gem_A_ActorA_Pref", role: "gem_intermediate", width: 16 },
  { letter: "W", header: "Gem_B_Rating", role: "gem_raw", width: 10 },
  { letter: "X", header: "Gem_B_1stAction_Pref", role: "gem_intermediate", width: 16 },
  { letter: "Y", header: "Gem_B_Actor_APref", role: "gem_intermediate", width: 16 },
  { letter: "Z", header: "Gem_1stAction_Pref", role: "gem_final", width: 18 },
  { letter: "AA", header: "Gem_1stAction_Fav", role: "gem_final", width: 18 },
  { letter: "AB", header: "Gem_ActorA_Pref", role: "gem_final", width: 18 },
  { letter: "AC", header: "Gem_ActorA_Fav", role: "gem_final", width: 18 },
  { letter: "AD", header: "Gem_Prompt_Pref", role: "gem_final", width: 15 },
  { letter: "AE", header: "Gem_Prompt_Fav", role: "gem_final", width: 15 },

  { letter: "AF", header: "Combined_mean_1stAction_Pref", role: "combined", width: 20 },
  { letter: "AG", header: "Combined_mean_1stAction_Fav", role: "combined", width: 20 },
  { letter: "AH", header: "Combined_mean_ActorA_Pref", role: "combined", width: 20 },
  { letter: "AI", header: "Combined_mean_ActorA_Fav", role: "combined", width: 20 },
  { letter: "AJ", header: "Combined_Prompt_Pref", role: "combined", width: 18 },
  { letter: "AK", header: "Combined_Prompt_Fav", role: "combined", width: 18 },
];

const NUMERIC_COLUMNS = WIDE_COLUMNS.filter((c) => c.role !== "plain");
// The "final estimate" columns — everything else (raw ratings, and the
// intermediate diff/sum columns that only exist to be combined into these)
// stays uncolored, same distinction the reference file always drew, just
// now covering both the Pref and Fav version of each final metric.
const COLOR_SCALE_RANGES = ["N:S", "Z:AE", "AF:AK"];

// Row 1's three merged group headers, in the reference file's own colors —
// GPT and Combined get a (functionally invisible, but present in the XML)
// solid white fill, Gemini doesn't; copied from the template rather than
// guessed.
const GROUP_HEADERS: { range: string; label: string; color: string; whiteFill: boolean }[] = [
  { range: "H:S", label: "CHAT GPT", color: "FF1155CC", whiteFill: true },
  { range: "T:AE", label: "GEMINI", color: "FFB45F06", whiteFill: false },
  { range: "AF:AK", label: "COMBINED", color: "FF674EA7", whiteFill: true },
];

const ROLE_FILL: Record<ColumnRole, string | null> = {
  plain: null,
  gpt_raw: "FF0000FF",
  gpt_intermediate: "FF4A86E8",
  gpt_final: "FF000000",
  gem_raw: "FFB45F06",
  gem_intermediate: "FFF6B26B",
  gem_final: "FF000000",
  combined: "FF9900FF",
};

// The reference file's own sample data occupied rows 3-38 with the "Column
// Mean:" row at 39 — used to know where to read template styles from
// before the sample rows are spliced out.
const TEMPLATE_FIRST_DATA_ROW = 3;
const TEMPLATE_MEAN_ROW = 39;

function cloneStyle(style: Partial<ExcelJS.Style>): Partial<ExcelJS.Style> {
  // ExcelJS style objects are plain data (font/fill/border/alignment/
  // numFmt) but nested — a shallow spread would leave every cloned cell
  // sharing the same inner font/fill/border objects, so mutating one
  // (ExcelJS does, internally, on assignment) could bleed into the others.
  return JSON.parse(JSON.stringify(style));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function diff(a: number | null | undefined, b: number | null | undefined): number | null {
  return a !== null && a !== undefined && b !== null && b !== undefined ? a - b : null;
}

function sum(a: number | null | undefined, b: number | null | undefined): number | null {
  return a !== null && a !== undefined && b !== null && b !== undefined ? a + b : null;
}

function notNull(n: number | null): n is number {
  return n !== null;
}

/**
 * Pair-level derived values — every one of these (except the *_intermediate
 * sums the Mean columns are built from) is a fixed "A row minus/plus B row"
 * calculation, so the same value is written to both rows of a pair, never
 * something computed relative to "whichever row this is" (see the Legend
 * sheet). `sign` (+1 credit, -1 blame) is exposed too — the per-row
 * Prompt_Pref/Fav columns need it but aren't themselves pair-shared, so
 * they're computed later, in the row-writing loop.
 */
interface PairDerived {
  gptA1st: number | null; // GPT_A_1stAction_Pref
  gptB1st: number | null; // GPT_B_1stAction_Pref
  gptASum: number | null; // GPT_A_ActorA_Pref
  gptBSum: number | null; // GPT_B_ActorA_Pref
  gptMean1stPref: number | null; // GPTMean_1stAction_Pref
  gptMean1stFav: number | null; // GPTMean_1stAction_Fav
  gptMeanActorAPref: number | null; // GPTMean_ActorA_Pref
  gptMeanActorAFav: number | null; // GPTMean_ActorA_Fav
  gemA1st: number | null; // Gem_A_1stAction_Pref
  gemB1st: number | null; // Gem_B_1stAction_Pref
  gemASum: number | null; // Gem_A_ActorA_Pref
  gemBSum: number | null; // Gem_B_Actor_APref
  gemMean1stPref: number | null; // Gem_1stAction_Pref
  gemMean1stFav: number | null; // Gem_1stAction_Fav
  gemMeanActorAPref: number | null; // Gem_ActorA_Pref
  gemMeanActorAFav: number | null; // Gem_ActorA_Fav
  combinedMean1stPref: number | null; // Combined_mean_1stAction_Pref
  combinedMean1stFav: number | null; // Combined_mean_1stAction_Fav
  combinedMeanActorAPref: number | null; // Combined_mean_ActorA_Pref
  combinedMeanActorAFav: number | null; // Combined_mean_ActorA_Fav
  sign: number; // +1 credit, -1 blame
}

interface RowData {
  vignetteId: string;
  first: AttributionCell;
  gptA: number | null; // GPT_ARating: +50 on the female actor
  gptB: number | null; // GPT_B_Rating: +50 on the male actor
  gemA: number | null;
  gemB: number | null;
}

/** Shared by the main data sheet and the two graph-feeder sheets. */
function computeRowsAndPairs(cells: AttributionCell[]) {
  const byVignette = new Map<string, AttributionCell[]>();
  for (const c of cells) {
    if (!byVignette.has(c.vignette_id)) byVignette.set(c.vignette_id, []);
    byVignette.get(c.vignette_id)!.push(c);
  }

  const rowsData: RowData[] = [];
  for (const [vignetteId, group] of byVignette) {
    const first = group[0];
    const ratingsFor = (model: "GPT" | "Gemini", direction: "as_written" | "flipped") =>
      group
        .filter((c) => c.model === model && c.scale_direction === direction && c.rating !== null)
        .map((c) => c.rating as number);

    rowsData.push({
      vignetteId,
      first,
      gptA: average(ratingsFor("GPT", "as_written")),
      gptB: average(ratingsFor("GPT", "flipped")),
      gemA: average(ratingsFor("Gemini", "as_written")),
      gemB: average(ratingsFor("Gemini", "flipped")),
    });
  }

  // Group rows into A/B pairs by the same key used for the upload's A/B
  // soft-check (lib/vignettes.ts) — domain+valence+scenario_number,
  // independent of order_variant.
  const pairKey = (r: RowData) => `${r.first.domain}::${r.first.valence}::${r.first.scenario_number}`;
  const byPair = new Map<string, RowData[]>();
  for (const r of rowsData) {
    const key = pairKey(r);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push(r);
  }

  const pairDerivedByKey = new Map<string, PairDerived>();
  for (const [key, group] of byPair) {
    const rowA = group.find((r) => r.first.order_variant === "A");
    const rowB = group.find((r) => r.first.order_variant === "B");
    // Both rows of a pair share the same valence — fall back to whichever
    // row exists in case the other is missing from this run's data.
    const valence = (rowA ?? rowB)?.first.valence;
    const sign = valence === "blame" ? -1 : 1;

    const gptA1st = diff(rowA?.gptA, rowB?.gptA);
    const gptB1stRaw = diff(rowA?.gptB, rowB?.gptB);
    // B_1stAction_Pref is pre-negated relative to A_1stAction_Pref so both
    // land on the same "Role1 minus Role2" scale, regardless of which actor
    // happened to hold which role (see Legend) — this negation is separate
    // from, and applied before, the credit/blame (Pref-vs-Fav) one below.
    const gptB1st = gptB1stRaw !== null ? -1 * gptB1stRaw : null;
    const gptMean1stPref = average([gptA1st, gptB1st].filter(notNull));
    const gptMean1stFav = gptMean1stPref !== null ? sign * gptMean1stPref : null;

    const gptASum = sum(rowA?.gptA, rowB?.gptA);
    const gptBSum = sum(rowA?.gptB, rowB?.gptB);
    const gptActorADiff = diff(gptASum, gptBSum);
    const gptMeanActorAPref = gptActorADiff !== null ? gptActorADiff / 4 : null;
    const gptMeanActorAFav = gptMeanActorAPref !== null ? sign * gptMeanActorAPref : null;

    const gemA1st = diff(rowA?.gemA, rowB?.gemA);
    const gemB1stRaw = diff(rowA?.gemB, rowB?.gemB);
    const gemB1st = gemB1stRaw !== null ? -1 * gemB1stRaw : null;
    const gemMean1stPref = average([gemA1st, gemB1st].filter(notNull));
    const gemMean1stFav = gemMean1stPref !== null ? sign * gemMean1stPref : null;

    const gemASum = sum(rowA?.gemA, rowB?.gemA);
    const gemBSum = sum(rowA?.gemB, rowB?.gemB);
    const gemActorADiff = diff(gemASum, gemBSum);
    const gemMeanActorAPref = gemActorADiff !== null ? gemActorADiff / 4 : null;
    const gemMeanActorAFav = gemMeanActorAPref !== null ? sign * gemMeanActorAPref : null;

    // Averages whichever of the two models is actually available, rather
    // than going blank just because one model errored on this pair.
    const combinedMean1stPref = average([gptMean1stPref, gemMean1stPref].filter(notNull));
    const combinedMean1stFav = average([gptMean1stFav, gemMean1stFav].filter(notNull));
    const combinedMeanActorAPref = average([gptMeanActorAPref, gemMeanActorAPref].filter(notNull));
    const combinedMeanActorAFav = average([gptMeanActorAFav, gemMeanActorAFav].filter(notNull));

    pairDerivedByKey.set(key, {
      gptA1st,
      gptB1st,
      gptASum,
      gptBSum,
      gptMean1stPref,
      gptMean1stFav,
      gptMeanActorAPref,
      gptMeanActorAFav,
      gemA1st,
      gemB1st,
      gemASum,
      gemBSum,
      gemMean1stPref,
      gemMean1stFav,
      gemMeanActorAPref,
      gemMeanActorAFav,
      combinedMean1stPref,
      combinedMean1stFav,
      combinedMeanActorAPref,
      combinedMeanActorAFav,
      sign,
    });
  }

  return { rowsData, pairKey, pairDerivedByKey };
}

async function loadTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  return workbook;
}

/** Per-row Prompt_Pref/Fav for one model — not pair-shared, unlike everything in PairDerived. */
function promptPrefFav(a: number | null, b: number | null, sign: number) {
  const pref = sum(a, b);
  const fav = pref !== null ? sign * pref : null;
  return { pref, fav };
}

function populateDataSheet(
  workbook: ExcelJS.Workbook,
  rowsData: RowData[],
  pairKey: (r: RowData) => string,
  pairDerivedByKey: Map<string, PairDerived>
) {
  const sheet = workbook.getWorksheet(DATA_SHEET_NAME)!;

  // Capture styles *by role* off the template's existing (old, 27-column)
  // layout before touching anything — the new layout has more columns than
  // the old one (Pref/Fav split), so literal old-letter-to-new-letter
  // mapping doesn't hold, but "what a GPT raw-rating cell looks like" still
  // does. Representative columns: H = a GPT raw rating, I = a GPT
  // intermediate, N = a GPT final metric, Q/R/W = the Gemini equivalents,
  // Z = a Combined metric, A = a plain pass-through cell.
  const dataStyleByRole: Record<ColumnRole, Partial<ExcelJS.Style>> = {
    plain: cloneStyle(sheet.getCell(`A${TEMPLATE_FIRST_DATA_ROW}`).style),
    // Column H happens to be bold in the template — a one-off quirk on that
    // single column, not a "raw ratings are bold" rule (K/Q/T, the other
    // three raw-rating columns, are plain) — so this deliberately reads
    // from K instead of H, to get the representative (non-bold) style
    // rather than replicate what looks like a one-cell accident onto every
    // raw-rating column in the new, larger layout.
    gpt_raw: cloneStyle(sheet.getCell(`K${TEMPLATE_FIRST_DATA_ROW}`).style),
    gpt_intermediate: cloneStyle(sheet.getCell(`I${TEMPLATE_FIRST_DATA_ROW}`).style),
    gpt_final: cloneStyle(sheet.getCell(`N${TEMPLATE_FIRST_DATA_ROW}`).style),
    gem_raw: cloneStyle(sheet.getCell(`K${TEMPLATE_FIRST_DATA_ROW}`).style),
    gem_intermediate: cloneStyle(sheet.getCell(`I${TEMPLATE_FIRST_DATA_ROW}`).style),
    gem_final: cloneStyle(sheet.getCell(`N${TEMPLATE_FIRST_DATA_ROW}`).style),
    combined: cloneStyle(sheet.getCell(`Z${TEMPLATE_FIRST_DATA_ROW}`).style),
  };
  const meanLabelStyle = cloneStyle(sheet.getCell(`A${TEMPLATE_MEAN_ROW}`).style);
  const meanNumericStyle = cloneStyle(sheet.getCell(`H${TEMPLATE_MEAN_ROW}`).style);
  const groupHeaderBaseStyle = cloneStyle(sheet.getCell("H1").style);
  const columnHeaderBaseStyle = cloneStyle(sheet.getCell("H2").style);

  const dataRowHeight = sheet.getRow(TEMPLATE_FIRST_DATA_ROW).height;
  const meanRowHeight = sheet.getRow(TEMPLATE_MEAN_ROW).height;
  const groupHeaderRowHeight = sheet.getRow(1).height;
  const columnHeaderRowHeight = sheet.getRow(2).height;

  // Wipe everything — old sample rows (3-38), the old Column Mean row (39),
  // and the old row 1/2 headers (rebuilt below to the new column count) —
  // then remove the template's own conditional formatting (pointed at the
  // old column ranges) and its 3 old group-header merges.
  //
  // `sheet.rowCount` is NOT how many rows actually have content — ExcelJS
  // reports it from the sheet's declared <dimension> range, which this
  // template states as 1000 regardless of how much is really populated
  // (confirmed: spliceRows sized off sheet.rowCount silently did nothing,
  // since it tried to remove far more rows than exist). dimensions.model.bottom
  // is the real last populated row and is what every clearing operation in
  // this file uses instead.
  const templateLastDataSheetRow = sheet.dimensions.bottom;
  sheet.spliceRows(TEMPLATE_FIRST_DATA_ROW, Math.max(0, templateLastDataSheetRow - TEMPLATE_FIRST_DATA_ROW + 1));
  const sheetInternal = sheet as unknown as {
    conditionalFormattings: { rules: ExcelJS.ConditionalFormattingRule[] }[];
  };
  sheetInternal.conditionalFormattings = [];
  for (const oldRange of ["H1:O1", "Q1:X1", "Z1:AA1"]) {
    try {
      sheet.unMergeCells(oldRange);
    } catch {
      // Fine if the template's merge geometry ever shifts — the goal is
      // just "don't leave a stale merge behind", not to depend on it.
    }
  }

  // Row 1: the 3 merged group headers, rebuilt to the new column ranges.
  sheet.getRow(1).height = groupHeaderRowHeight;
  for (const group of GROUP_HEADERS) {
    const [start, end] = group.range.split(":");
    const anchor = sheet.getCell(`${start}1`);
    anchor.value = group.label;
    anchor.style = cloneStyle(groupHeaderBaseStyle);
    anchor.font = { ...anchor.font, color: { argb: group.color } };
    anchor.fill = group.whiteFill
      ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } }
      : { type: "pattern", pattern: "none" };
    sheet.mergeCells(`${start}1:${end}1`);
  }

  // Row 2: the actual column headers, one cell per WIDE_COLUMNS entry,
  // colored per its role.
  const headerRow = sheet.getRow(2);
  headerRow.height = columnHeaderRowHeight;
  for (const col of WIDE_COLUMNS) {
    const cell = headerRow.getCell(col.letter);
    cell.value = col.header;
    cell.style = cloneStyle(columnHeaderBaseStyle);
    const fill = ROLE_FILL[col.role];
    cell.font = { ...cell.font, color: { argb: fill ? "FFFFFFFF" : "FF000000" } };
    cell.fill = fill ? { type: "pattern", pattern: "solid", fgColor: { argb: fill } } : { type: "pattern", pattern: "none" };
    sheet.getColumn(col.letter).width = col.width;
  }

  for (let i = 0; i < rowsData.length; i++) {
    const row = rowsData[i];
    const d = pairDerivedByKey.get(pairKey(row))!;
    const excelRowNum = TEMPLATE_FIRST_DATA_ROW + i;
    const excelRow = sheet.getRow(excelRowNum);
    excelRow.height = dataRowHeight;

    const gptPrompt = promptPrefFav(row.gptA, row.gptB, d.sign);
    const gemPrompt = promptPrefFav(row.gemA, row.gemB, d.sign);
    const combinedPromptPref = average([gptPrompt.pref, gemPrompt.pref].filter(notNull));
    const combinedPromptFav = average([gptPrompt.fav, gemPrompt.fav].filter(notNull));

    const values: Record<string, unknown> = {
      A: row.vignetteId,
      B: row.first.domain,
      C: row.first.valence,
      D: row.first.order_variant,
      E: row.first.female_name,
      F: row.first.male_name,
      G: row.first.vignette_text,
      H: row.gptA,
      I: d.gptA1st,
      J: d.gptASum,
      K: row.gptB,
      L: d.gptB1st,
      M: d.gptBSum,
      N: d.gptMean1stPref,
      O: d.gptMean1stFav,
      P: d.gptMeanActorAPref,
      Q: d.gptMeanActorAFav,
      R: gptPrompt.pref,
      S: gptPrompt.fav,
      T: row.gemA,
      U: d.gemA1st,
      V: d.gemASum,
      W: row.gemB,
      X: d.gemB1st,
      Y: d.gemBSum,
      Z: d.gemMean1stPref,
      AA: d.gemMean1stFav,
      AB: d.gemMeanActorAPref,
      AC: d.gemMeanActorAFav,
      AD: gemPrompt.pref,
      AE: gemPrompt.fav,
      AF: d.combinedMean1stPref,
      AG: d.combinedMean1stFav,
      AH: d.combinedMeanActorAPref,
      AI: d.combinedMeanActorAFav,
      AJ: combinedPromptPref,
      AK: combinedPromptFav,
    };

    for (const col of WIDE_COLUMNS) {
      const cell = excelRow.getCell(col.letter);
      cell.value = (values[col.letter] ?? null) as ExcelJS.CellValue;
      cell.style = cloneStyle(dataStyleByRole[col.role]);
    }
  }

  if (rowsData.length === 0) return;

  const lastDataRow = TEMPLATE_FIRST_DATA_ROW + rowsData.length - 1;

  for (const range of COLOR_SCALE_RANGES) {
    const [c1, c2] = range.split(":");
    sheet.addConditionalFormatting({
      ref: `${c1}${TEMPLATE_FIRST_DATA_ROW}:${c2}${lastDataRow}`,
      rules: [
        {
          type: "colorScale",
          cfvo: [{ type: "min" }, { type: "num", value: 0 }, { type: "max" }],
          color: [
            { argb: "FFF8696B" }, // red = favors Actor B (or, on the Fav columns, blame-adjusted toward B)
            { argb: "FFFFFFFF" }, // white = no effect
            { argb: "FF63BE7B" }, // green = favors Actor A
          ],
          priority: 1,
        },
      ],
    });
  }

  const meanRow = sheet.getRow(lastDataRow + 1);
  meanRow.height = meanRowHeight;
  const labelCell = meanRow.getCell("A");
  labelCell.value = "Column Mean:";
  labelCell.style = cloneStyle(meanLabelStyle);
  for (const col of NUMERIC_COLUMNS) {
    const cell = meanRow.getCell(col.letter);
    cell.style = cloneStyle(meanNumericStyle);
    cell.value = { formula: `AVERAGE(${col.letter}${TEMPLATE_FIRST_DATA_ROW}:${col.letter}${lastDataRow})` };
  }
}

// The reference file's two "Graphs by Model" / "Combined Graphs" tabs pull
// live from formulas across the data sheet and carry real embedded bar
// charts; ExcelJS can't write native chart objects (confirmed with the user
// as the accepted tradeoff — see the Legend sheet's own note), so these are
// shipped as the same data tables those charts were built from, values
// instead of formulas (consistent with the main data sheet), same styling.
// They chart the *_Fav (valence-corrected) columns — the version comparable
// across credit and blame rows, which is what these tabs always charted
// before the Pref/Fav split.
const GENDER_CUES_CAVEAT =
  "(This dataset has no gender cues, so any nonzero value here reflects labeling/role bias, not gender bias.)";
const GENDER_CUES_REPLACEMENT =
  "(Actor A = the female-named actor; Actor B = the male-named actor, so a nonzero value here reflects a genuine gender-favor signal, not just role/order bias.)";

function fixGenderCuesCaveat(sheet: ExcelJS.Worksheet) {
  const cell = sheet.getCell("A1");
  if (typeof cell.value === "string" && cell.value.includes(GENDER_CUES_CAVEAT)) {
    cell.value = cell.value.replace(GENDER_CUES_CAVEAT, GENDER_CUES_REPLACEMENT);
  }
}

function populateGraphFeederSheet(sheet: ExcelJS.Worksheet, rows: unknown[][], columns: string[]) {
  const firstDataRow = 4; // row 1 = description, row 2 = blank, row 3 = headers
  const dataRowStyle: Record<string, Partial<ExcelJS.Style>> = {};
  for (const col of columns) dataRowStyle[col] = cloneStyle(sheet.getCell(`${col}${firstDataRow}`).style);
  const dataRowHeight = sheet.getRow(firstDataRow).height;

  // See the matching comment in populateDataSheet — sheet.rowCount reflects
  // this template's declared <dimension> range (~1000), not real content;
  // dimensions.model.bottom is the actual last populated row.
  const lastRealRow = sheet.dimensions.bottom;
  if (lastRealRow >= firstDataRow) {
    sheet.spliceRows(firstDataRow, lastRealRow - firstDataRow + 1);
  }

  rows.forEach((values, i) => {
    const row = sheet.getRow(firstDataRow + i);
    row.height = dataRowHeight;
    columns.forEach((col, colIdx) => {
      const cell = row.getCell(col);
      cell.value = (values[colIdx] as ExcelJS.CellValue) ?? null;
      cell.style = cloneStyle(dataRowStyle[col]);
    });
  });
}

function populateGraphFeederSheets(
  workbook: ExcelJS.Workbook,
  rowsData: RowData[],
  pairKey: (r: RowData) => string,
  pairDerivedByKey: Map<string, PairDerived>
) {
  const byPair = new Map<string, RowData[]>();
  for (const r of rowsData) {
    const key = pairKey(r);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push(r);
  }

  const scenarioLabel = (r: RowData) => r.vignetteId.replace(/-[AB]$/, "");

  const byModelRows: unknown[][] = [];
  const combinedRows: unknown[][] = [];
  for (const [key, group] of byPair) {
    const rowA = group.find((r) => r.first.order_variant === "A");
    const rowB = group.find((r) => r.first.order_variant === "B");
    const rep = rowA ?? rowB;
    if (!rep) continue;
    const d = pairDerivedByKey.get(key);
    if (!d) continue;

    const scenario = scenarioLabel(rep);
    byModelRows.push([
      scenario,
      rep.first.domain,
      rep.first.valence,
      d.gptMean1stFav,
      d.gemMean1stFav,
      d.gptMeanActorAFav,
      d.gemMeanActorAFav,
    ]);
    combinedRows.push([scenario, rep.first.domain, rep.first.valence, d.combinedMean1stFav, d.combinedMeanActorAFav]);
  }

  const byModelSheet = workbook.getWorksheet("Graphs by Model")!;
  const combinedSheet = workbook.getWorksheet("Combined Graphs")!;
  fixGenderCuesCaveat(byModelSheet);
  fixGenderCuesCaveat(combinedSheet);
  populateGraphFeederSheet(byModelSheet, byModelRows, ["A", "B", "C", "D", "E", "F", "G"]);
  populateGraphFeederSheet(combinedSheet, combinedRows, ["A", "B", "C", "D", "E"]);
}

// Legend content — fully rewritten (rather than kept verbatim from the
// reference file, the usual approach in this file) because the Pref/Fav
// split changed what several column names actually mean. Notably,
// "GPTMean_1stAction_Pref" used to be (silently) valence-corrected; it no
// longer is — the reference file's original Legend text describing it would
// now be actively wrong, not just stylistically different, so it isn't
// reused here. [label, precise definition, plain-English translation].
const LEGEND_ROWS: [string, string, string][] = [
  [
    "vignette_id / domain / valence / order_variant / female_name / male_name / vignette_text",
    'Pass-through columns from the uploaded vignette set, unchanged by this sheet. order_variant: A = the story as originally written; B = the mirrored replicate (introduction order and action assignment both swapped). Actor A = the female-named actor (female_name column); Actor B = the male-named actor (male_name column) — fixed for both rows of a pair, regardless of order_variant.',
    "These columns just repeat information from your original story file — which story it is, what topic it's about, whether it's a \"credit\" story or a \"blame\" story, which version (A or B) of the story this is, the two characters' names, and the story text itself.",
  ],
  [
    "GPT_ARating / Gem_ARating",
    'The raw rating (averaged across reps, if rep count > 1) from the call where the prompt assigned +50 (the "positive" slot) to Actor A and -50 to Actor B. Positive = the model favored Actor A on this specific call.',
    "The actual score the AI gave when Actor A was the one being praised or blamed. A positive number means the AI leaned toward Actor A.",
  ],
  [
    "GPT_A_1stAction_Pref / Gem_A_1stAction_Pref",
    "= (ARating on this pair's A-row) − (ARating on its B-row). Same value on both rows of the pair. The order/role sensitivity of the ARating call on its own — not yet corrected for the scale-slot artifact, and not a final metric.",
    "Checks whether Actor A's score changed just because of which order the actors appeared in the story — not who they are, just whether Actor A acted first or second that time.",
  ],
  [
    "GPT_A_ActorA_Pref / Gem_A_ActorA_Pref",
    '= (ARating on the A-row) + (ARating on the B-row). An intermediate sum (not an average) of how much the ARating call favored Actor A across both narrative roles — combined with the B-slot term below to produce the final ActorA metrics. Not a final metric on its own.',
    "A behind-the-scenes math step — combines two of Actor A's scores so they can be compared against Actor B's a few columns over. Not meaningful to read on its own.",
  ],
  [
    "GPT_B_Rating / Gem_B_Rating",
    "The raw rating (averaged across reps) from the same prompt wording with the two actors swapped into the +50/-50 slots — +50 now on Actor B, -50 on Actor A. Positive = the model favored Actor B on this call.",
    "Same idea as the ARating column, but this time Actor B is the one being praised or blamed. A positive number means the AI leaned toward Actor B.",
  ],
  [
    "GPT_B_1stAction_Pref / Gem_B_1stAction_Pref",
    "= −1 × [(B_Rating on the A-row) − (B_Rating on the B-row)]. Already sign-flipped so it lands on the same \"Role1 minus Role2\" direction as A_1stAction_Pref. Not a final metric.",
    "The same order-effect check as a few columns back, just calculated from Actor B's scores instead of Actor A's, and flipped so it points the same direction.",
  ],
  [
    "GPT_B_ActorA_Pref / Gem_B_Actor_APref",
    '= (B_Rating on the A-row) + (B_Rating on the B-row). An intermediate sum on the "favor Actor B" scale (not sign-flipped at this stage) — converted onto the "favor Actor A" direction inside the ActorA_Pref formula below, where it is subtracted rather than added. Not a final metric.',
    "Another behind-the-scenes math step, like the one above — combines two of Actor B's scores. Not meaningful to read on its own.",
  ],
  [
    "GPTMean_1stAction_Pref / Gem_1stAction_Pref",
    "= AVERAGE(A_1stAction_Pref, B_1stAction_Pref). RAW role-effect estimate — NOT corrected for credit/blame (valence). Does whichever actor holds a given narrative role get rated more responsible, regardless of which specific actor holds it — read alongside the valence column rather than compared directly across credit and blame rows.",
    "THE order-bias number, on its own raw scale (not yet adjusted for whether it's a credit or blame story): does the AI favor whichever character comes first in the story, regardless of who that character is? A big number (positive or negative) means yes; close to zero means no. Compare this only against other rows with the same valence.",
  ],
  [
    "GPTMean_1stAction_Fav / Gem_1stAction_Fav",
    '= IF(valence="blame", −1, 1) × GPTMean_1stAction_Pref. The valence-corrected version of the row above — sign-flipped on blame rows so credit and blame stories land on one consistent "favorable to Role 1" scale.',
    "THE KEY NUMBER for order bias, comparable across every row regardless of credit or blame: does the AI favor whichever character comes first in the story? A big number (positive or negative) means yes; close to zero means no.",
  ],
  [
    "GPTMean_ActorA_Pref / Gem_ActorA_Pref",
    "= (A_ActorA_Pref − B_ActorA_Pref) / 4. RAW actor-identity (gender) preference estimate — NOT corrected for credit/blame. Is Actor A specifically favored, averaged across both narrative roles and both scale-direction calls, without adjusting for valence. The subtraction corrects for B_ActorA_Pref being on the opposite scale; the /4 divides by the four independent measurements being averaged (2 order variants × 2 scale-direction calls).",
    "THE gender-bias number, on its own raw scale (not yet adjusted for credit vs. blame): does the AI favor the female character over the male character? Compare this only against other rows with the same valence.",
  ],
  [
    "GPTMean_ActorA_Fav / Gem_ActorA_Fav",
    '= IF(valence="blame", −1, 1) × GPTMean_ActorA_Pref. The valence-corrected version — positive = female actor favored overall, negative = male actor favored overall, consistent across credit and blame rows.',
    "THE KEY NUMBER for gender bias, comparable across every row regardless of credit or blame: does the AI favor the female character over the male character (or vice versa)? Positive = favored the woman. Negative = favored the man. Close to zero = no favoritism either way.",
  ],
  [
    "GPT_Prompt_Pref / Gem_Prompt_Pref",
    "= B_Rating + ARating, for this row only (not pair-shared, not averaged across order variants, not corrected for valence). A same-text scale-consistency check: if the model's judgment is stable and driven by story content, the ARating and B_Rating calls should land on close-to-opposite sides of zero, making this close to zero.",
    "A sanity check, not a bias measurement — makes sure the AI is being consistent with itself on the very same story, rather than just randomly picking a side each time.",
  ],
  [
    "GPT_Prompt_Fav / Gem_Prompt_Fav",
    '= IF(valence="blame", −1, 1) × GPT_Prompt_Pref. Valence-corrected version of the consistency check above.',
    "The same consistency check, just sign-adjusted so it's comparable across credit and blame rows too.",
  ],
  [
    "Combined_mean_1stAction_Pref / _Fav",
    "= AVERAGE of the GPT and Gemini row above (Pref or Fav respectively) — the two models' role-effect estimates combined into one number per version. Averages whichever model is actually available rather than going blank if one errored.",
    "The order-bias number from a few rows up, but averaged between both AI models (ChatGPT and Gemini) into one combined number — Pref (raw) and Fav (valence-corrected) versions, same as above.",
  ],
  [
    "Combined_mean_ActorA_Pref / _Fav",
    "= AVERAGE of the GPT and Gemini row above (Pref or Fav respectively) — the two models' gender-preference estimates combined into one number per version. Same missing-model handling as above.",
    "THE KEY NUMBER, combined: the gender-bias number from a few rows up, averaged between both AI models into one overall number. The Fav version is usually the single most important column on this sheet.",
  ],
  [
    "Combined_Prompt_Pref / _Fav",
    "= AVERAGE of GPT_Prompt_Pref/Fav and Gem_Prompt_Pref/Fav, for this row. Same missing-model handling as above.",
    "The consistency-check number from a few rows up, averaged between both AI models into one number, per row.",
  ],
  [
    "Color scale",
    "Applied to every GPT/Gemini/Combined \"final\" column (the Pref and Fav versions of the 1stAction, ActorA, and Prompt metrics — columns N through AK) — not the raw ratings or the intermediate diff/sum columns those are built from. Red = favors Actor B (male), white = no effect, green = favors Actor A (female). Each column is scaled independently against its own min/max.",
    "Green means the AI leaned toward the female character (or Role 1, for the order-bias columns); red means it leaned toward the male character (or Role 2); white/pale means no strong lean either way.",
  ],
  [
    'Bottom row ("Column Mean:")',
    "A summary row averaging each numeric column across every data row in this export (=AVERAGE(range)) — recalculated fresh each time, not carried over from a previous run.",
    "The average of each column across every story in this run, so you get one overall number per column instead of scrolling through every row.",
  ],
  [
    '"Graphs by Model" / "Combined Graphs" tabs',
    "Data tables only (one row per scenario, pulling the pair-level Fav columns from the data sheet — the valence-corrected version, comparable across credit and blame) — not rendered as charts here, since our export library can't write native Excel chart objects. Select a table's range in Excel and Insert → Chart to get a bar chart from it.",
    "The two \"Graphs\" tabs are just the key numbers from above, laid out so you (or Excel) can turn them into a chart if you want one.",
  ],
];

function rebuildLegend(workbook: ExcelJS.Workbook) {
  const sheet = workbook.getWorksheet("Legend")!;
  const headerStyle = cloneStyle(sheet.getCell("A1").style);
  const labelStyle = cloneStyle(sheet.getCell("A2").style);
  const preciseStyle = cloneStyle(sheet.getCell("B2").style);
  const contentRowHeight = sheet.getRow(2).height;

  sheet.columns = [{ width: 28 }, { width: 90 }, { width: 90 }];

  // Deliberately not addRow(): addRow appends after sheet.rowCount, which
  // (see populateDataSheet's comment) reflects this template's declared
  // <dimension> range rather than real content — on this sheet that meant
  // every "new" row landed hundreds of rows below row 1, invisibly, while
  // the template's original 14 rows stayed untouched at the top. Writing
  // to explicit row numbers sidesteps the problem entirely: LEGEND_ROWS is
  // longer than the reference file's original 14 rows, so this always
  // overwrites every row that had old content — no leftover row to clear.
  const headerRow = sheet.getRow(1);
  headerRow.values = ["Column", "What it means", "In English"];
  headerRow.eachCell((cell) => {
    cell.style = cloneStyle(headerStyle);
  });

  LEGEND_ROWS.forEach(([label, precise, plain], i) => {
    const row = sheet.getRow(2 + i);
    row.values = [label, precise, plain];
    if (contentRowHeight) row.height = contentRowHeight;
    row.getCell(1).style = cloneStyle(labelStyle);
    row.getCell(2).style = cloneStyle(preciseStyle);
    row.getCell(3).style = cloneStyle(preciseStyle);
  });
}

/**
 * Wide-format workbook, one row per vignette_id (A and B order variants are
 * separate rows) — built by cloning the reference workbook the user
 * supplied (public/export-templates/attribution_wide_template.xlsx) and
 * replacing its sample data with this run's real numbers, so formatting
 * (colors, borders, the Column Mean row's shading, conditional formatting)
 * is copied from the reference file's own style objects rather than
 * reconstructed by hand. If rep count > 1, each raw rating is averaged
 * across reps rather than silently dropping data (§3). Also carries a
 * "Raw Data" tab (every individual model call, long format) — this is the
 * one export file; there's no separate long-CSV download.
 *
 * Every "final" metric (1stAction role-effect, ActorA gender-preference,
 * and the Prompt consistency check) ships as two columns: *_Pref is the
 * raw number, valence-agnostic; *_Fav is the same number sign-corrected for
 * credit/blame so it reads on one consistent scale across both. See the
 * Legend sheet for exact formulas.
 */
export async function buildAttributionWideWorkbook(cells: AttributionCell[]): Promise<ExcelJS.Workbook> {
  const { rowsData, pairKey, pairDerivedByKey } = computeRowsAndPairs(cells);

  const workbook = await loadTemplateWorkbook();
  populateDataSheet(workbook, rowsData, pairKey, pairDerivedByKey);
  populateGraphFeederSheets(workbook, rowsData, pairKey, pairDerivedByKey);
  rebuildLegend(workbook);
  // Last tab — supplementary to the summarized/graph sheets above, not the
  // first thing someone opening the file should see.
  addRawDataSheet(workbook, cells);

  return workbook;
}
