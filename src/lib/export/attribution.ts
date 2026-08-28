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
  "rating",
  "favor_female",
  "raw_response",
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
      c.rating,
      favorFemale(c),
      c.raw_response,
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

const DATA_SHEET_NAME = "Attribution Summarized Data";
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

/**
 * Pair-level derived values — every one of these is a fixed "A row minus
 * (or plus) B row" calculation, so the same value is written to both rows
 * of a pair, never something computed relative to "whichever row this is"
 * (see the Legend sheet). Computed once per pair, then looked up by both
 * rows and by the two graph-feeder sheets, rather than recomputed each
 * place it's used.
 */
interface PairDerived {
  gptA1st: number | null; // GPT_A_1stAction_Pref
  gptB1st: number | null; // GPT_B_1stAction_Pref
  gptASum: number | null; // GPT_A_ActorA_Pref
  gptBSum: number | null; // GPT_B_ActorA_Pref
  gptMean1st: number | null; // GPTMean_1stAction_Pref
  gptMeanActorA: number | null; // GPTMean_ActorA_Pref
  gemA1st: number | null; // Gem_A_1stAction_Pref
  gemB1st: number | null; // Gem_B_1stAction_Pref
  gemASum: number | null; // Gem_A_ActorA_Pref
  gemBSum: number | null; // Gem_B_Actor_APref
  gemMean1st: number | null; // Gem_1stAction_Pref
  gemMeanActorA: number | null; // Gem_ActorA_Pref
  combinedMean1st: number | null; // Combined_mean_1stAction_Pref
  combinedMeanActorA: number | null; // Combined_mean_ActorA_Pref
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
    // happened to hold which role (see Legend).
    const gptB1st = gptB1stRaw !== null ? -1 * gptB1stRaw : null;
    const gptMean1stRaw = average([gptA1st, gptB1st].filter((n): n is number => n !== null));
    const gptMean1st = gptMean1stRaw !== null ? sign * gptMean1stRaw : null;

    const gptASum = sum(rowA?.gptA, rowB?.gptA);
    const gptBSum = sum(rowA?.gptB, rowB?.gptB);
    const gptActorARaw = diff(gptASum, gptBSum);
    const gptMeanActorA = gptActorARaw !== null ? (sign * gptActorARaw) / 4 : null;

    const gemA1st = diff(rowA?.gemA, rowB?.gemA);
    const gemB1stRaw = diff(rowA?.gemB, rowB?.gemB);
    const gemB1st = gemB1stRaw !== null ? -1 * gemB1stRaw : null;
    const gemMean1stRaw = average([gemA1st, gemB1st].filter((n): n is number => n !== null));
    const gemMean1st = gemMean1stRaw !== null ? sign * gemMean1stRaw : null;

    const gemASum = sum(rowA?.gemA, rowB?.gemA);
    const gemBSum = sum(rowA?.gemB, rowB?.gemB);
    const gemActorARaw = diff(gemASum, gemBSum);
    const gemMeanActorA = gemActorARaw !== null ? (sign * gemActorARaw) / 4 : null;

    // Averages whichever of the two models is actually available, rather
    // than going blank just because one model errored on this pair.
    const combinedMean1st = average([gptMean1st, gemMean1st].filter((n): n is number => n !== null));
    const combinedMeanActorA = average([gptMeanActorA, gemMeanActorA].filter((n): n is number => n !== null));

    pairDerivedByKey.set(key, {
      gptA1st,
      gptB1st,
      gptASum,
      gptBSum,
      gptMean1st,
      gptMeanActorA,
      gemA1st,
      gemB1st,
      gemASum,
      gemBSum,
      gemMean1st,
      gemMeanActorA,
      combinedMean1st,
      combinedMeanActorA,
    });
  }

  return { rowsData, pairKey, pairDerivedByKey };
}

async function loadTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  return workbook;
}

function populateDataSheet(
  workbook: ExcelJS.Workbook,
  rowsData: RowData[],
  pairKey: (r: RowData) => string,
  pairDerivedByKey: Map<string, PairDerived>
) {
  const sheet = workbook.getWorksheet(DATA_SHEET_NAME)!;

  // Capture every style this template actually uses — from its own sample
  // data row and its own Column Mean row — before any of it gets removed.
  // Rows 1-2 (the merged group headers + column headers) are never touched
  // at all, so whatever the template does there just carries through as-is.
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
  // addConditionalFormatting to add more) — read/cleared here via a narrow
  // escape hatch rather than the untyped `any` the rest of the file avoids.
  const sheetInternal = sheet as unknown as {
    conditionalFormattings: { rules: ExcelJS.ConditionalFormattingRule[] }[];
  };
  const cfRuleDefs = sheetInternal.conditionalFormattings.map((cf) => cf.rules);

  // Remove the sample rows and the old Column Mean row (and the
  // conditional formatting pointed at their row range) — column widths,
  // freeze panes, and the row 1-2 headers live outside this row range and
  // are untouched by spliceRows.
  sheet.spliceRows(TEMPLATE_FIRST_DATA_ROW, sheet.rowCount - TEMPLATE_FIRST_DATA_ROW + 1);
  sheetInternal.conditionalFormattings = [];

  for (let i = 0; i < rowsData.length; i++) {
    const row = rowsData[i];
    const d = pairDerivedByKey.get(pairKey(row))!;
    const excelRowNum = TEMPLATE_FIRST_DATA_ROW + i;
    const excelRow = sheet.getRow(excelRowNum);
    excelRow.height = dataRowHeight;

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
      N: d.gptMean1st,
      O: d.gptMeanActorA,
      P: sum(row.gptA, row.gptB),
      Q: row.gemA,
      R: d.gemA1st,
      S: d.gemASum,
      T: row.gemB,
      U: d.gemB1st,
      V: d.gemBSum,
      W: d.gemMean1st,
      X: d.gemMeanActorA,
      Y: sum(row.gemA, row.gemB),
      Z: d.combinedMean1st,
      AA: d.combinedMeanActorA,
    };

    for (const col of ALL_COLS) {
      const cell = excelRow.getCell(col);
      cell.value = (values[col] ?? null) as ExcelJS.CellValue;
      cell.style = cloneStyle(dataRowStyle[col]);
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
    sheet.addConditionalFormatting({ ref: sqref, rules: cfRuleDefs[i] });
  }

  const meanRow = sheet.getRow(lastDataRow + 1);
  meanRow.height = meanRowHeight;
  for (const col of ALL_COLS) {
    const cell = meanRow.getCell(col);
    cell.style = cloneStyle(meanRowStyle[col]);
    if (col === "A") {
      cell.value = "Column Mean:";
    } else if (NUMERIC_COLS.has(col)) {
      cell.value = { formula: `AVERAGE(${col}${TEMPLATE_FIRST_DATA_ROW}:${col}${lastDataRow})` };
    }
  }
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

// Two rows appended to the reference file's own Legend sheet — its existing
// 14 rows are left completely untouched (same text, same styling), these
// two just add what real (non-placeholder) run data needs beyond what the
// reference file's own neutral-placeholder test data required.
const LEGEND_APPENDIX: [string, string][] = [
  [
    "Actor A / Actor B",
    'Actor A = the female-named actor (the name in the female_name column). Actor B = the male-named actor (male_name column). Fixed for both rows of a pair, regardless of order_variant — so "favors Actor A" always means "favors the female actor," never a role/order label.',
  ],
  [
    '"Graphs by Model" / "Combined Graphs" tabs',
    "Data tables only (one row per scenario, pulling the pair-level Mean/Combined columns from the data sheet) — not rendered as charts here, since our export library can't write native Excel chart objects. Select a table's range in Excel and Insert → Chart to get a bar chart from it.",
  ],
];

function appendToLegend(workbook: ExcelJS.Workbook) {
  const sheet = workbook.getWorksheet("Legend")!;
  let row = 1;
  while (sheet.getCell(`A${row}`).value !== null && sheet.getCell(`A${row}`).value !== undefined) row++;

  const styleA = cloneStyle(sheet.getCell("A2").style);
  const styleB = cloneStyle(sheet.getCell("B2").style);
  const contentRowHeight = sheet.getRow(2).height;

  for (const [label, text] of LEGEND_APPENDIX) {
    const excelRow = sheet.getRow(row);
    if (contentRowHeight) excelRow.height = contentRowHeight;
    excelRow.getCell("A").value = label;
    excelRow.getCell("A").style = cloneStyle(styleA);
    excelRow.getCell("B").value = text;
    excelRow.getCell("B").style = cloneStyle(styleB);
    row++;
  }
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
 */
export async function buildAttributionWideWorkbook(cells: AttributionCell[]): Promise<ExcelJS.Workbook> {
  const { rowsData, pairKey, pairDerivedByKey } = computeRowsAndPairs(cells);

  const workbook = await loadTemplateWorkbook();
  populateDataSheet(workbook, rowsData, pairKey, pairDerivedByKey);
  populateGraphFeederSheets(workbook, rowsData, pairKey, pairDerivedByKey);
  appendToLegend(workbook);
  // Last tab — supplementary to the summarized/graph sheets above, not the
  // first thing someone opening the file should see.
  addRawDataSheet(workbook, cells);

  return workbook;
}
