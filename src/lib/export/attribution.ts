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
 * Matches the wide export's net_female_favor exactly (same two corrections,
 * same order), just applied to one raw rating instead of a pre-combined
 * woman_positive/man_positive pair. See the "Legend" sheet on the wide
 * export.
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
// (Revised_Sheet_Format.xlsx, "Attribution Summarized Data" / "Legend" /
// "Graphs by Model" / "Combined Graphs") rather than reconstructing its
// formatting from scratch — an earlier from-scratch attempt at this quietly
// diverged from the reference on borders, the Column Mean row's fill, the
// GPT_ARating column's bold data cells, and the exact (overlapping) column
// ranges its conditional-formatting rules cover. Cloning every style object
// directly off the real file makes "identical formatting" a copy, not
// something re-derived and hoped to match. The template lives in public/ so
// it's guaranteed to ship in the serverless deployment; it was re-saved
// through openpyxl once before being checked in, to flatten Excel's "shared
// formula" optimization, which otherwise makes ExcelJS throw when the
// sample rows are spliced out — the flattened file evaluates to the exact
// same values, just without that internal optimization — and its embedded
// charts were dropped (unused — see the Graphs sheets' handling below).
const TEMPLATE_PATH = path.join(
  process.cwd(),
  "public",
  "export-templates",
  "attribution_wide_template.xlsx"
);

// The template file's data sheet is still literally named "Attribution
// Summarized Data" on disk — found by that name, then immediately renamed
// to FAVORABILITY_SHEET_NAME (see populateFavorabilitySheet) before any
// other processing, so every other reference to "the data sheet" in this
// file uses its final, user-facing name instead.
const TEMPLATE_DATA_SHEET_NAME = "Attribution Summarized Data";
const FAVORABILITY_SHEET_NAME = "Favorability Bias";
const RESPONSIBILITY_SHEET_NAME = "Responsibility Bias";
const ALL_COLS = [
  "A", "B", "C", "D", "E", "F", "G",
  "H", "I", "J", "K", "L", "M", "N", "O", "P",
  "Q", "R", "S", "T", "U", "V", "W", "X", "Y",
  "Z", "AA",
] as const;
// Every column from GPT_ARating onward is numeric — everything before it
// (vignette_id..vignette_text) is a plain pass-through value.
const NUMERIC_COLS = new Set(ALL_COLS.slice(7));

// The reference file's own sample data occupies rows 3-38, with the "Column
// Mean:" row at 39 — used both to know where to read template styles from
// and where the real data should start once the sample rows are removed.
const TEMPLATE_FIRST_DATA_ROW = 3;
const TEMPLATE_MEAN_ROW = 39;

// The reference file's 3 conditional-formatting rules cover overlapping,
// slightly asymmetric column groups (e.g. GPT_B_ActorA_Pref is colored but
// its GPT_A_ActorA_Pref counterpart isn't) — copied exactly as column-letter
// groups here, row-independent, so the *shape* of the reference file's
// formatting is preserved byte-for-byte rather than "cleaned up" into a
// tidier set of columns.
const CF_RULE_COLUMN_GROUPS: string[][] = [
  ["M:P", "V:V", "X:Y"],
  ["V:W"],
  ["X:AA"],
];

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

function halve(a: number | null): number | null {
  return a !== null ? a / 2 : null;
}

/**
 * Pair-level derived values — every one of these is a fixed "A row minus
 * (or plus) B row" calculation, so the same value is written to both rows
 * of a pair, never something computed relative to "whichever row this is"
 * (see the Legend sheet). Computed once per pair, then looked up by both
 * rows and by the two graph-feeder sheets, rather than recomputed each
 * place it's used.
 */
// Every *Mean*/*Combined* field below comes in a signed (valence-corrected —
// what the "Favorability Bias" tab shows) and raw (uncorrected — what
// "Responsibility Bias" shows) version. Everything else (the A/B
// intermediate diff/sum columns, and Prompt_Diff, computed in
// populateDataSheetRow below) was never valence-corrected to begin with, so
// it's identical on both tabs — only these six pairs actually differ.
interface PairDerived {
  gptA1st: number | null; // GPT_A_1stAction_Pref
  gptB1st: number | null; // GPT_B_1stAction_Pref
  gptASum: number | null; // GPT_A_ActorA_Pref
  gptBSum: number | null; // GPT_B_ActorA_Pref
  gptMean1st: number | null; // GPTMean_1stAction_Pref (signed)
  gptMean1stRaw: number | null; // same, not corrected for valence
  gptMeanActorA: number | null; // GPTMean_ActorA_Pref (signed)
  gptMeanActorARaw: number | null; // same, not corrected for valence
  gemA1st: number | null; // Gem_A_1stAction_Pref
  gemB1st: number | null; // Gem_B_1stAction_Pref
  gemASum: number | null; // Gem_A_ActorA_Pref
  gemBSum: number | null; // Gem_B_Actor_APref
  gemMean1st: number | null; // Gem_1stAction_Pref (signed)
  gemMean1stRaw: number | null; // same, not corrected for valence
  gemMeanActorA: number | null; // Gem_ActorA_Pref (signed)
  gemMeanActorARaw: number | null; // same, not corrected for valence
  combinedMean1st: number | null; // Combined_mean_1stAction_Pref (signed)
  combinedMean1stRaw: number | null; // same, not corrected for valence
  combinedMeanActorA: number | null; // Combined_mean_ActorA_Pref (signed)
  combinedMeanActorARaw: number | null; // same, not corrected for valence
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

    // Halved per the professor's request — A_1stAction_Pref and
    // B_1stAction_Pref are each /2 on top of the existing diff/sign-flip;
    // GPTMean_1stAction_Pref below is unchanged (still just AVERAGE of
    // these two), so it inherits the halving automatically.
    const gptA1st = halve(diff(rowA?.gptA, rowB?.gptA));
    const gptB1stRaw = diff(rowA?.gptB, rowB?.gptB);
    // B_1stAction_Pref is pre-negated relative to A_1stAction_Pref so both
    // land on the same "Role1 minus Role2" scale, regardless of which actor
    // happened to hold which role (see Legend).
    const gptB1st = gptB1stRaw !== null ? (-1 * gptB1stRaw) / 2 : null;
    const gptMean1stRaw = average([gptA1st, gptB1st].filter((n): n is number => n !== null));
    const gptMean1st = gptMean1stRaw !== null ? sign * gptMean1stRaw : null;

    const gptASum = sum(rowA?.gptA, rowB?.gptA);
    const gptBSum = sum(rowA?.gptB, rowB?.gptB);
    const gptActorARaw = diff(gptASum, gptBSum);
    const gptMeanActorARaw = gptActorARaw !== null ? gptActorARaw / 4 : null;
    const gptMeanActorA = gptMeanActorARaw !== null ? sign * gptMeanActorARaw : null;

    const gemA1st = halve(diff(rowA?.gemA, rowB?.gemA));
    const gemB1stRaw = diff(rowA?.gemB, rowB?.gemB);
    const gemB1st = gemB1stRaw !== null ? (-1 * gemB1stRaw) / 2 : null;
    const gemMean1stRaw = average([gemA1st, gemB1st].filter((n): n is number => n !== null));
    const gemMean1st = gemMean1stRaw !== null ? sign * gemMean1stRaw : null;

    const gemASum = sum(rowA?.gemA, rowB?.gemA);
    const gemBSum = sum(rowA?.gemB, rowB?.gemB);
    const gemActorARaw = diff(gemASum, gemBSum);
    const gemMeanActorARaw = gemActorARaw !== null ? gemActorARaw / 4 : null;
    const gemMeanActorA = gemMeanActorARaw !== null ? sign * gemMeanActorARaw : null;

    // Averages whichever of the two models is actually available, rather
    // than going blank just because one model errored on this pair.
    const combinedMean1st = average([gptMean1st, gemMean1st].filter((n): n is number => n !== null));
    const combinedMean1stRaw = average([gptMean1stRaw, gemMean1stRaw].filter((n): n is number => n !== null));
    const combinedMeanActorA = average([gptMeanActorA, gemMeanActorA].filter((n): n is number => n !== null));
    const combinedMeanActorARaw = average(
      [gptMeanActorARaw, gemMeanActorARaw].filter((n): n is number => n !== null)
    );

    pairDerivedByKey.set(key, {
      gptA1st,
      gptB1st,
      gptASum,
      gptBSum,
      gptMean1st,
      gptMean1stRaw,
      gptMeanActorA,
      gptMeanActorARaw,
      gemA1st,
      gemB1st,
      gemASum,
      gemBSum,
      gemMean1st,
      gemMean1stRaw,
      gemMeanActorA,
      gemMeanActorARaw,
      combinedMean1st,
      combinedMean1stRaw,
      combinedMeanActorA,
      combinedMeanActorARaw,
    });
  }

  return { rowsData, pairKey, pairDerivedByKey };
}

async function loadTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  return workbook;
}

interface DataSheetStyles {
  dataRowStyle: Record<string, Partial<ExcelJS.Style>>;
  meanRowStyle: Record<string, Partial<ExcelJS.Style>>;
  dataRowHeight: number;
  meanRowHeight: number;
  cfRuleDefs: ExcelJS.ConditionalFormattingRule[][];
}

/**
 * Captures every style the template's data sheet actually uses — from its
 * own sample data row and its own Column Mean row — before any of it gets
 * touched. Read once, reused for both the Favorability Bias sheet (built in
 * place, cloning the template) and the Responsibility Bias sheet (a fresh
 * sheet with no styles of its own yet).
 */
function captureDataSheetStyles(sheet: ExcelJS.Worksheet): DataSheetStyles {
  const dataRowStyle: Record<string, Partial<ExcelJS.Style>> = {};
  const meanRowStyle: Record<string, Partial<ExcelJS.Style>> = {};
  for (const col of ALL_COLS) {
    dataRowStyle[col] = cloneStyle(sheet.getCell(`${col}${TEMPLATE_FIRST_DATA_ROW}`).style);
    meanRowStyle[col] = cloneStyle(sheet.getCell(`${col}${TEMPLATE_MEAN_ROW}`).style);
  }
  const dataRowHeight = sheet.getRow(TEMPLATE_FIRST_DATA_ROW).height;
  const meanRowHeight = sheet.getRow(TEMPLATE_MEAN_ROW).height;
  // ExcelJS stores existing conditional formatting on a `conditionalFormattings`
  // array, but doesn't expose a public getter/type for it (only
  // addConditionalFormatting to add more) — read here via a narrow escape
  // hatch rather than the untyped `any` the rest of the file avoids.
  const sheetInternal = sheet as unknown as {
    conditionalFormattings: { rules: ExcelJS.ConditionalFormattingRule[] }[];
  };
  const cfRuleDefs = sheetInternal.conditionalFormattings.map((cf) => cf.rules);
  return { dataRowStyle, meanRowStyle, dataRowHeight, meanRowHeight, cfRuleDefs };
}

/**
 * Removes the template's sample rows and old Column Mean row (and the
 * conditional formatting pointed at their row range) from a sheet that
 * still has them — i.e. only the Favorability Bias sheet, which is the
 * template's own data sheet cloned in place. Column widths, freeze panes,
 * and the row 1-2 headers live outside this row range and are untouched.
 */
function clearTemplateSampleRows(sheet: ExcelJS.Worksheet) {
  const sheetInternal = sheet as unknown as {
    conditionalFormattings: { rules: ExcelJS.ConditionalFormattingRule[] }[];
  };
  sheet.spliceRows(TEMPLATE_FIRST_DATA_ROW, sheet.rowCount - TEMPLATE_FIRST_DATA_ROW + 1);
  sheetInternal.conditionalFormattings = [];
}

/**
 * Writes the actual data rows + Column Mean row into a sheet that already
 * has correct row 1-2 headers and column widths (either the template's own,
 * for Favorability Bias, or copied from it, for Responsibility Bias).
 * `useValenceSign` picks which of each Mean/Combined pair PairDerived
 * carries — signed (valence-corrected — Favorability Bias) or raw
 * (Responsibility Bias) — everything else is identical between the two
 * sheets, since only those six columns were ever valence-corrected.
 */
function writeDataRows(
  sheet: ExcelJS.Worksheet,
  rowsData: RowData[],
  pairKey: (r: RowData) => string,
  pairDerivedByKey: Map<string, PairDerived>,
  styles: DataSheetStyles,
  useValenceSign: boolean
) {
  for (let i = 0; i < rowsData.length; i++) {
    const row = rowsData[i];
    const d = pairDerivedByKey.get(pairKey(row))!;
    const excelRowNum = TEMPLATE_FIRST_DATA_ROW + i;
    const excelRow = sheet.getRow(excelRowNum);
    excelRow.height = styles.dataRowHeight;

    const values: Partial<Record<(typeof ALL_COLS)[number], unknown>> = {
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
      N: useValenceSign ? d.gptMean1st : d.gptMean1stRaw,
      O: useValenceSign ? d.gptMeanActorA : d.gptMeanActorARaw,
      P: halve(sum(row.gptA, row.gptB)), // GPT_Prompt_Diff — never valence-corrected, same on both sheets
      Q: row.gemA,
      R: d.gemA1st,
      S: d.gemASum,
      T: row.gemB,
      U: d.gemB1st,
      V: d.gemBSum,
      W: useValenceSign ? d.gemMean1st : d.gemMean1stRaw,
      X: useValenceSign ? d.gemMeanActorA : d.gemMeanActorARaw,
      Y: halve(sum(row.gemA, row.gemB)), // Gem_Prompt_Diff — never valence-corrected, same on both sheets
      Z: useValenceSign ? d.combinedMean1st : d.combinedMean1stRaw,
      AA: useValenceSign ? d.combinedMeanActorA : d.combinedMeanActorARaw,
    };

    for (const col of ALL_COLS) {
      const cell = excelRow.getCell(col);
      cell.value = (values[col] ?? null) as ExcelJS.CellValue;
      cell.style = cloneStyle(styles.dataRowStyle[col]);
    }
  }

  if (rowsData.length === 0) return;

  const lastDataRow = TEMPLATE_FIRST_DATA_ROW + rowsData.length - 1;

  for (let i = 0; i < CF_RULE_COLUMN_GROUPS.length; i++) {
    const sqref = CF_RULE_COLUMN_GROUPS[i]
      .map((range) => {
        const [c1, c2] = range.split(":");
        return `${c1}${TEMPLATE_FIRST_DATA_ROW}:${c2}${lastDataRow}`;
      })
      .join(" ");
    sheet.addConditionalFormatting({ ref: sqref, rules: styles.cfRuleDefs[i] });
  }

  const meanRow = sheet.getRow(lastDataRow + 1);
  meanRow.height = styles.meanRowHeight;
  for (const col of ALL_COLS) {
    const cell = meanRow.getCell(col);
    cell.style = cloneStyle(styles.meanRowStyle[col]);
    if (col === "A") {
      cell.value = "Column Mean:";
    } else if (NUMERIC_COLS.has(col)) {
      cell.value = { formula: `AVERAGE(${col}${TEMPLATE_FIRST_DATA_ROW}:${col}${lastDataRow})` };
    }
  }
}

/**
 * The template's own data sheet, renamed and populated in place with the
 * valence-corrected ("favors Actor A vs. favors Actor B", comparable across
 * credit and blame) version of every Mean/Combined column. Returns the
 * sheet and the styles captured from it, so Responsibility Bias (below)
 * can reuse both without re-reading a second, separately-loaded template.
 */
function populateFavorabilitySheet(
  workbook: ExcelJS.Workbook,
  rowsData: RowData[],
  pairKey: (r: RowData) => string,
  pairDerivedByKey: Map<string, PairDerived>
): { sheet: ExcelJS.Worksheet; styles: DataSheetStyles } {
  const sheet = workbook.getWorksheet(TEMPLATE_DATA_SHEET_NAME)!;
  sheet.name = FAVORABILITY_SHEET_NAME;

  const styles = captureDataSheetStyles(sheet);
  clearTemplateSampleRows(sheet);
  writeDataRows(sheet, rowsData, pairKey, pairDerivedByKey, styles, true);

  return { sheet, styles };
}

/**
 * A sibling of Favorability Bias with the exact same structure (rows 1-2,
 * column widths, freeze panes, all copied cell-by-cell from the already-
 * built Favorability sheet — copying a 2-row header is small and reliable;
 * ExcelJS has no supported "clone this whole worksheet" API, and an attempt
 * at one via its internal `.model` didn't survive a round-trip for merges),
 * but every Mean/Combined column left uncorrected for valence — so it shows
 * raw responsibility-attribution, not "who does the model favor."
 */
function addResponsibilityBiasSheet(
  workbook: ExcelJS.Workbook,
  favorabilitySheet: ExcelJS.Worksheet,
  styles: DataSheetStyles,
  rowsData: RowData[],
  pairKey: (r: RowData) => string,
  pairDerivedByKey: Map<string, PairDerived>
) {
  const sheet = workbook.addWorksheet(RESPONSIBILITY_SHEET_NAME);
  // addWorksheet always appends at the end (Graphs by Model, Combined
  // Graphs, Raw Data would all land ahead of it) — "next to" Favorability
  // Bias means immediately after it, so re-slot this sheet's tab-order
  // position directly. ExcelJS sorts tabs by this `orderNo` property
  // (undocumented in its public types, but it's a plain assignable number,
  // not deep internal state) rather than by insertion order.
  (sheet as unknown as { orderNo: number }).orderNo =
    (favorabilitySheet as unknown as { orderNo: number }).orderNo + 0.5;

  for (const rowNum of [1, 2]) {
    const sourceRow = favorabilitySheet.getRow(rowNum);
    const targetRow = sheet.getRow(rowNum);
    targetRow.height = sourceRow.height;
    for (const col of ALL_COLS) {
      const sourceCell = favorabilitySheet.getCell(`${col}${rowNum}`);
      const targetCell = sheet.getCell(`${col}${rowNum}`);
      targetCell.value = sourceCell.value;
      targetCell.style = cloneStyle(sourceCell.style);
    }
  }
  for (const merge of ["H1:O1", "Q1:X1", "Z1:AA1"]) {
    sheet.mergeCells(merge);
  }
  for (const col of ALL_COLS) {
    sheet.getColumn(col).width = favorabilitySheet.getColumn(col).width;
  }
  sheet.views = favorabilitySheet.views;

  writeDataRows(sheet, rowsData, pairKey, pairDerivedByKey, styles, false);
}

// The reference file's two "Graphs by Model" / "Combined Graphs" tabs pull
// live from formulas across the data sheet and carry real embedded bar
// charts; ExcelJS can't write native chart objects (confirmed with the user
// as the accepted tradeoff — see the Legend appendix below), so these are
// shipped as the same data tables those charts were built from, values
// instead of formulas (consistent with the main data sheet), same styling.
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

  if (sheet.rowCount >= firstDataRow) {
    sheet.spliceRows(firstDataRow, sheet.rowCount - firstDataRow + 1);
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
    byModelRows.push([scenario, rep.first.domain, rep.first.valence, d.gptMean1st, d.gemMean1st, d.gptMeanActorA, d.gemMeanActorA]);
    combinedRows.push([scenario, rep.first.domain, rep.first.valence, d.combinedMean1st, d.combinedMeanActorA]);
  }

  const byModelSheet = workbook.getWorksheet("Graphs by Model")!;
  const combinedSheet = workbook.getWorksheet("Combined Graphs")!;
  fixGenderCuesCaveat(byModelSheet);
  fixGenderCuesCaveat(combinedSheet);
  populateGraphFeederSheet(byModelSheet, byModelRows, ["A", "B", "C", "D", "E", "F", "G"]);
  populateGraphFeederSheet(combinedSheet, combinedRows, ["A", "B", "C", "D", "E"]);
}

// Plain-English translation of the reference file's own 14 Legend rows
// (rows 2-14 — row 1 is the header) — same order, added as a new column
// (C) rather than replacing "What it means", so the exact, precise
// definitions stay exactly as the reference file wrote them and this is
// purely additive: read column B for the precise formula, column C for the
// one-sentence version.
const LEGEND_PLAIN_ENGLISH: string[] = [
  // row 2: pass-through columns
  "These columns just repeat information from your original story file — which story it is, what topic it's about, whether it's a \"credit\" story or a \"blame\" story, which version (A or B) of the story this is, the two characters' names, and the story text itself.",
  // row 3: GPT_ARating / Gem_ARating
  "The actual score the AI gave when Actor A was the one being praised or blamed. A positive number means the AI leaned toward Actor A.",
  // row 4: GPT_A_1stAction_Pref / Gem_A_1stAction_Pref
  "Checks whether Actor A's score changed just because of which order the actors appeared in the story — not who they are, just whether Actor A acted first or second that time. (Halved — the result you see is this check's raw difference divided by two.)",
  // row 5: GPT_A_ActorA_Pref / Gem_A_ActorA_Pref
  "A behind-the-scenes math step — combines two of Actor A's scores so they can be compared against Actor B's a few columns over. Not meaningful to read on its own.",
  // row 6: GPT_B_Rating / Gem_B_Rating
  "Same idea as the ARating column, but this time Actor B is the one being praised or blamed. A positive number means the AI leaned toward Actor B.",
  // row 7: GPT_B_1stAction_Pref / Gem_B_1stAction_Pref
  "The same order-effect check as a few columns back, just calculated from Actor B's scores instead of Actor A's, and flipped so it points the same direction. (Also halved, same as the Actor A version.)",
  // row 8: GPT_B_ActorA_Pref / Gem_B_Actor_APref
  "Another behind-the-scenes math step, like the one above — combines two of Actor B's scores. Not meaningful to read on its own.",
  // row 9: GPTMean_1stAction_Pref / Gem_1stAction_Pref
  "THE KEY NUMBER for order bias: does the AI favor whichever character comes first in the story, regardless of who that character is? A big number (positive or negative) means yes; close to zero means no.",
  // row 10: GPTMean_ActorA_Pref / Gem_ActorA_Pref
  "THE KEY NUMBER for gender bias: does the AI favor the female character over the male character (or vice versa), no matter which order they appear in? Positive = favored the woman. Negative = favored the man. Close to zero = no favoritism either way.",
  // row 11: GPT_Prompt_Diff / Gem_Prompt_Diff
  "A sanity check, not a bias measurement — makes sure the AI is being consistent with itself on the very same story, rather than just randomly picking a side each time. (Halved — this is the raw sum divided by two.)",
  // row 12: Combined_mean_1stAction_Pref
  "The order-bias number from a few rows up, but averaged between both AI models (ChatGPT and Gemini) into one combined number.",
  // row 13: Combined_mean_ActorA_Pref
  "THE KEY NUMBER, combined: the gender-bias number from a few rows up, averaged between both AI models into one overall number. Usually the single most important column on this sheet.",
  // row 14: Column Mean row
  "The average of each column across every story in this run, so you get one overall number per column instead of scrolling through every row.",
];

function addPlainEnglishColumn(workbook: ExcelJS.Workbook) {
  const sheet = workbook.getWorksheet("Legend")!;
  const styleB = cloneStyle(sheet.getCell("B2").style);

  // "In English" column — header cloned from the existing B1 header style,
  // content cells cloned from B's own content style (same font/wrap, just a
  // new column) so it reads as part of the same sheet, not a bolt-on. The
  // reference file's own 14 rows (and their A/B content) are otherwise left
  // completely untouched — this only ever adds column C.
  sheet.getColumn("C").width = 90;
  sheet.getCell("C1").value = "In English";
  sheet.getCell("C1").style = cloneStyle(sheet.getCell("B1").style);
  LEGEND_PLAIN_ENGLISH.forEach((text, i) => {
    const excelRow = sheet.getRow(2 + i); // rows 2-14, the reference file's own rows
    excelRow.getCell("C").value = text;
    excelRow.getCell("C").style = cloneStyle(styleB);
  });
}

/**
 * Wide-format workbook, one row per vignette_id (A and B order variants are
 * separate rows) — built by cloning the reference workbook the user
 * supplied (public/export-templates/attribution_wide_template.xlsx) and
 * replacing its sample data with this run's real numbers, so every bit of
 * formatting (colors, borders, the Column Mean row's shading, conditional
 * formatting) matches the reference file exactly rather than being
 * reconstructed by hand. If rep count > 1, each raw rating is averaged
 * across reps rather than silently dropping data (§3). Also carries a
 * "Raw Data" tab (every individual model call, long format) — this is now
 * the one export file; there's no separate long-CSV download anymore.
 *
 * The summarized data ships as two sheets, identical except for the six
 * Mean/Combined columns (1stAction and ActorA, per model and combined):
 * "Favorability Bias" applies the credit/blame sign correction (does the
 * model favor Actor A vs. Actor B, on one scale comparable across both
 * valences); "Responsibility Bias" leaves those same six columns
 * uncorrected (raw attribution, valence-agnostic). Every other column —
 * raw ratings, the A/B intermediate diff/sum columns, Prompt_Diff — was
 * never valence-corrected in the first place, so it's identical on both.
 */
export async function buildAttributionWideWorkbook(cells: AttributionCell[]): Promise<ExcelJS.Workbook> {
  const { rowsData, pairKey, pairDerivedByKey } = computeRowsAndPairs(cells);

  const workbook = await loadTemplateWorkbook();
  const { sheet: favorabilitySheet, styles } = populateFavorabilitySheet(workbook, rowsData, pairKey, pairDerivedByKey);
  addResponsibilityBiasSheet(workbook, favorabilitySheet, styles, rowsData, pairKey, pairDerivedByKey);
  populateGraphFeederSheets(workbook, rowsData, pairKey, pairDerivedByKey);
  addPlainEnglishColumn(workbook);
  // Last tab — supplementary to the summarized/graph sheets above, not the
  // first thing someone opening the file should see.
  addRawDataSheet(workbook, cells);

  return workbook;
}
