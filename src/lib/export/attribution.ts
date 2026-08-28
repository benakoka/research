import ExcelJS from "exceljs";
import { AttributionCell } from "@/lib/types";
import { toCsv } from "@/lib/csv";

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

/** Long-format CSV matching the DMP schema (§3 Output). */
export function buildAttributionLongCsv(cells: AttributionCell[]): string {
  const rows = cells.map((c) => [
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
  return toCsv([...LONG_HEADERS], rows);
}

// One row per vignette_id (order_variant A and B are separate rows), plus a
// GPT_/Gem_/Combined_ column family — matches the layout the user supplied
// in Revised_Sheet_Format.xlsx ("Attribution Summarized Data" tab), with
// "Actor A" resolved to the female-named actor and "Actor B" to the male-
// named actor (confirmed 2026-08-28 — this is what turns ActorA_Pref into a
// signed gender-favor estimate rather than an arbitrary order label).
const WIDE_HEADERS = [
  "vignette_id",
  "domain",
  "valence",
  "order_variant",
  "female_name",
  "male_name",
  "vignette_text",
  "GPT_ARating",
  "GPT_A_1stAction_Pref",
  "GPT_A_ActorA_Pref",
  "GPT_B_Rating",
  "GPT_B_1stAction_Pref",
  "GPT_B_ActorA_Pref",
  "GPTMean_1stAction_Pref",
  "GPTMean_ActorA_Pref",
  "GPT_Prompt_Diff",
  "Gem_ARating",
  "Gem_A_1stAction_Pref",
  "Gem_A_ActorA_Pref",
  "Gem_B_Rating",
  "Gem_B_1stAction_Pref",
  "Gem_B_Actor_APref",
  "Gem_1stAction_Pref",
  "Gem_ActorA_Pref",
  "Gem_Prompt_Diff",
  "Combined_mean_1stAction_Pref",
  "Combined_mean_ActorA_Pref",
] as const;

// Column widths, in the same order as WIDE_HEADERS — copied from the user's
// reference file rather than guessed.
const WIDE_COLUMN_WIDTHS = [
  31, 15.86, 15.43, 14.29, 15.29, 13, 22.71, 8.86, 13.71, 17.14, 10.14, 13, 18.14, 16, 19.57, 13.86, 9.29, 14.29, 17,
  9.86, 13.14, 15.43, 17.14, 14.86, 16.29, 18.57, 18.14,
];

// Header-row-2 fill color per column (null = plain pass-through column, no
// fill). Blue = GPT raw ratings, lighter blue = GPT derived diff/sum
// columns, black = GPT/Gemini "Mean"/"Prompt_Diff" columns, orange/light
// orange = the Gemini equivalents, purple = Combined — copied from the
// reference file's own color coding.
const WIDE_HEADER_FILLS: (string | null)[] = [
  null,
  null,
  null,
  null,
  null,
  null,
  null, // vignette_id..vignette_text
  "FF0000FF",
  "FF4A86E8",
  "FF4A86E8", // GPT_ARating, GPT_A_1stAction_Pref, GPT_A_ActorA_Pref
  "FF0000FF",
  "FF4A86E8",
  "FF4A86E8", // GPT_B_Rating, GPT_B_1stAction_Pref, GPT_B_ActorA_Pref
  "FF000000",
  "FF000000",
  "FF000000", // GPTMean_1stAction_Pref, GPTMean_ActorA_Pref, GPT_Prompt_Diff
  "FFB45F06",
  "FFF6B26B",
  "FFF6B26B", // Gem_ARating, Gem_A_1stAction_Pref, Gem_A_ActorA_Pref
  "FFB45F06",
  "FFF6B26B",
  "FFF6B26B", // Gem_B_Rating, Gem_B_1stAction_Pref, Gem_B_Actor_APref
  "FF000000",
  "FF000000",
  "FF000000", // Gem_1stAction_Pref, Gem_ActorA_Pref, Gem_Prompt_Diff
  "FF9900FF",
  "FF9900FF", // Combined_mean_1stAction_Pref, Combined_mean_ActorA_Pref
];

// The "final estimate" columns — everything else (raw ratings, and the
// intermediate diff/sum columns that only exist to be combined into these)
// is left uncolored, same distinction the reference file draws.
const WIDE_COLOR_SCALE_COLS = ["N", "O", "P", "W", "X", "Y", "Z", "AA"] as const;

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
 * Explains, in the file itself, the things that are easy to miss just from
 * the column headers: order_variant (A/B), the Actor A/B ↔ female/male
 * mapping, the raw-rating vs. derived-estimate columns, and that every
 * _1stAction_Pref/_ActorA_Pref/Mean/Combined value is a pair-level number —
 * the same value duplicated on both the A row and the B row of a scenario,
 * not something computed independently per row (the *_Prompt_Diff and raw
 * *_Rating columns are the only per-row exceptions).
 */
function addAttributionLegendSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.addWorksheet("Legend");
  sheet.columns = [{ width: 26 }, { width: 100 }];

  const rows: [string, string][] = [
    [
      "order_variant (A/B) / valence (credit/blame)",
      "Both from the uploaded vignette set, not generated by this run. order_variant: A = the story as originally written; B = the mirrored replicate — introduction order and action assignment both swapped (a separate, independently-written vignette_text, not a string substitution of A). valence: on a credit row, +50 for Actor A means the model thinks Actor A deserves the reward; on a blame row, +50 means Actor A deserves the reprimand — not corrected for on the raw *_Rating columns, only on the Mean/Combined columns below (see those rows).",
    ],
    [
      "Actor A / Actor B",
      "Actor A = the female-named actor (the name in the female_name column). Actor B = the male-named actor (male_name column). Fixed for both rows of a pair, regardless of order_variant — so \"favors Actor A\" always means \"favors the female actor,\" never a role/order label.",
    ],
    [
      "GPT_ARating / Gem_ARating",
      "The raw rating (averaged across reps, if rep count > 1) from the call where the prompt assigned +50 (the \"positive\" slot) to Actor A and -50 to Actor B. Positive = the model favored Actor A (the female actor) on this specific call.",
    ],
    [
      "GPT_A_1stAction_Pref / Gem_A_1stAction_Pref",
      "= (ARating on this pair's A-row) − (ARating on its B-row). Same value written on both rows of the pair. Measures how much this one scale-direction call's rating shifts purely from which order variant (narrative role) is being read — the order/role sensitivity of the ARating call on its own, not yet corrected for the scale-slot artifact.",
    ],
    [
      "GPT_A_ActorA_Pref / Gem_A_ActorA_Pref",
      "= (ARating on the A-row) + (ARating on the B-row). An intermediate sum (not yet an average) of how much the ARating call favored Actor A across both narrative roles she can hold. Still on the \"favor Actor A\" scale, at double the per-call magnitude — combined with the B-slot term below to produce the corrected ActorA_Pref estimate.",
    ],
    [
      "GPT_B_Rating / Gem_B_Rating",
      "The raw rating (averaged across reps) from the same prompt wording with the two actors swapped into the +50/-50 slots — +50 now on Actor B, -50 on Actor A. Positive = the model favored Actor B (the male actor) on this call.",
    ],
    [
      "GPT_B_1stAction_Pref / Gem_B_1stAction_Pref",
      "= −1 × [(B_Rating on the A-row) − (B_Rating on the B-row)]. Already sign-flipped so it lands on the same \"Role1 minus Role2\" direction as A_1stAction_Pref, regardless of which actor happens to hold which role. Same value on both rows of the pair.",
    ],
    [
      "GPT_B_ActorA_Pref / Gem_B_Actor_APref",
      "= (B_Rating on the A-row) + (B_Rating on the B-row). Despite the column name, this is an intermediate sum on the \"favor Actor B\" scale — not sign-flipped at this stage. Positive values mean Actor B (the male actor) was favored by the B-slot call; it's converted onto the \"favor Actor A\" direction inside the *_ActorA_Pref formula below, where it's subtracted rather than added.",
    ],
    [
      "GPTMean_1stAction_Pref / Gem_1stAction_Pref",
      "= IF(valence=\"blame\", −1, 1) × AVERAGE(A_1stAction_Pref, B_1stAction_Pref). The model's estimate of the pure ROLE effect: does whichever actor holds a given narrative role get rated more responsible, regardless of which specific actor holds it — sign-corrected so it's consistent across credit and blame rows. If the effect is really about actor identity (gender) rather than role, the two inputs tend to cancel toward 0.",
    ],
    [
      "GPTMean_ActorA_Pref / Gem_ActorA_Pref",
      "= IF(valence=\"blame\", −1, 1) × (A_ActorA_Pref − B_ActorA_Pref) / 4. The model's estimate of the pure GENDER (actor-identity) preference: is the female actor specifically favored, averaged across both narrative roles she appears in and both scale-direction calls, independent of role/order. Positive = female actor favored overall; negative = male actor favored overall. The subtraction corrects for B_ActorA_Pref being on the opposite (\"favor male\") scale; the /4 divides by the four independent measurements being averaged (2 order variants × 2 scale-direction calls).",
    ],
    [
      "GPT_Prompt_Diff / Gem_Prompt_Diff",
      "= B_Rating + ARating, for this row only (not pair-shared, not averaged across order variants). A same-text scale-consistency check: if the model's judgment is stable and driven by story content, the ARating call and the B_Rating call should land on close-to-opposite sides of zero, making this close to zero. A large nonzero value flags that both calls landed on the same side regardless of which actor held the positive scale slot — evidence the raw rating may be tracking the scale slot itself rather than giving a stable read of the story.",
    ],
    [
      "Combined_mean_1stAction_Pref",
      "= AVERAGE(GPTMean_1stAction_Pref, Gem_1stAction_Pref) — the two models' role-effect estimates combined into one number. Averages whichever of the two models is actually available rather than going blank if one errored.",
    ],
    [
      "Combined_mean_ActorA_Pref",
      "= AVERAGE(GPTMean_ActorA_Pref, Gem_ActorA_Pref) — the two models' gender (actor-identity) preference estimates combined into one number. Same missing-model handling as above.",
    ],
    [
      "Color scale",
      "Applied to GPTMean_1stAction_Pref, GPTMean_ActorA_Pref, GPT_Prompt_Diff, and their Gemini/Combined equivalents (columns N, O, P, W, X, Y, Z, AA) — the \"final estimate\" columns, not the raw ratings or the intermediate diff/sum columns that only exist to be combined into these. Red = favors Actor B (male), white = no effect, green = favors Actor A (female).",
    ],
    [
      "Bottom row (\"Column Mean:\")",
      "A summary row averaging each numeric column across every data row in this export (=AVERAGE(range)) — recalculated fresh each time, not carried over from a previous run.",
    ],
    [
      "\"Graphs by Model\" / \"Combined Graphs\" tabs",
      "Data tables only (one row per scenario, pulling the pair-level Mean/Combined columns from this sheet) — not rendered as charts here, since our export library can't write native Excel chart objects. Select a table's range in Excel and Insert → Chart to get the same bar chart the reference file shipped with.",
    ],
  ];

  sheet.addRow(["Column", "What it means"]);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.eachRow((row) => {
    row.alignment = { wrapText: true, vertical: "top" };
  });
  sheet.getColumn(1).font = { bold: true };
}

/**
 * Pair-level derived values — every one of these is a fixed "A row minus
 * (or plus) B row" calculation, so the same value is written to both rows
 * of a pair, never something computed relative to "whichever row this is"
 * (see the Legend sheet). Computed once per pair, then looked up by both
 * rows and by the two graph-feeder sheets below, rather than recomputed
 * each place it's used.
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

/**
 * Wide-format workbook, one row per vignette_id (A and B order variants are
 * separate rows), matching the layout in Revised_Sheet_Format.xlsx
 * ("Attribution Summarized Data"). If rep count > 1, each raw rating is
 * averaged across reps rather than silently dropping data (§3) — repCount
 * > 1 is flagged separately in the run UI.
 */
export function buildAttributionWideWorkbook(cells: AttributionCell[]): ExcelJS.Workbook {
  const byVignette = new Map<string, AttributionCell[]>();
  for (const c of cells) {
    if (!byVignette.has(c.vignette_id)) byVignette.set(c.vignette_id, []);
    byVignette.get(c.vignette_id)!.push(c);
  }

  // Pass 1: compute every row's own raw ARating/BRating (per model), without
  // writing them to the sheet yet — the pair-level columns need to see both
  // the A and B row of a scenario before either row can be finalized.
  interface RowData {
    vignetteId: string;
    first: AttributionCell;
    gptA: number | null; // GPT_ARating: +50 on the female actor
    gptB: number | null; // GPT_B_Rating: +50 on the male actor
    gemA: number | null;
    gemB: number | null;
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

  // Pass 2: group rows into A/B pairs by the same key used for the upload's
  // A/B soft-check (lib/vignettes.ts) — domain+valence+scenario_number,
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

  const workbook = new ExcelJS.Workbook();
  // Data sheet added first so it's what's active when the file opens — the
  // legend and graph tabs (added below) are there to be checked, not the
  // first thing seen every time.
  const sheet = workbook.addWorksheet("Attribution Summarized Data");

  // Row 1: merged group headers over the GPT/Gemini/Combined column blocks.
  sheet.getCell("H1").value = "CHAT GPT";
  sheet.mergeCells("H1:O1");
  sheet.getCell("Q1").value = "GEMINI";
  sheet.mergeCells("Q1:X1");
  sheet.getCell("Z1").value = "COMBINED";
  sheet.mergeCells("Z1:AA1");
  for (const [coord, color] of [
    ["H1", "FF1155CC"],
    ["Q1", "FFB45F06"],
    ["Z1", "FF674EA7"],
  ] as const) {
    sheet.getCell(coord).font = { bold: true, name: "Arial", color: { argb: color } };
  }
  sheet.getRow(1).height = 15;

  // Row 2: the actual column headers, colored per-column to match the
  // group they belong to (see WIDE_HEADER_FILLS).
  const headerRow = sheet.addRow([...WIDE_HEADERS]);
  headerRow.height = 26.25;
  headerRow.eachCell((cell, colNumber) => {
    const fill = WIDE_HEADER_FILLS[colNumber - 1];
    cell.font = { bold: true, name: "Arial", color: { argb: fill ? "FFFFFFFF" : "FF000000" } };
    if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.alignment = { wrapText: true, vertical: "bottom" };
  });

  for (const row of rowsData) {
    const d = pairDerivedByKey.get(pairKey(row))!;
    const gptPromptDiff = sum(row.gptA, row.gptB);
    const gemPromptDiff = sum(row.gemA, row.gemB);
    const excelRow = sheet.addRow([
      row.vignetteId,
      row.first.domain,
      row.first.valence,
      row.first.order_variant,
      row.first.female_name,
      row.first.male_name,
      row.first.vignette_text,
      row.gptA,
      d.gptA1st,
      d.gptASum,
      row.gptB,
      d.gptB1st,
      d.gptBSum,
      d.gptMean1st,
      d.gptMeanActorA,
      gptPromptDiff,
      row.gemA,
      d.gemA1st,
      d.gemASum,
      row.gemB,
      d.gemB1st,
      d.gemBSum,
      d.gemMean1st,
      d.gemMeanActorA,
      gemPromptDiff,
      d.combinedMean1st,
      d.combinedMeanActorA,
    ]);
    excelRow.font = { name: "Arial" };
  }

  const firstDataRow = 3;
  const lastRow = sheet.rowCount;

  WIDE_HEADERS.forEach((_, i) => {
    sheet.getColumn(i + 1).width = WIDE_COLUMN_WIDTHS[i];
  });

  if (lastRow >= firstDataRow) {
    for (const col of WIDE_COLOR_SCALE_COLS) {
      sheet.addConditionalFormatting({
        ref: `${col}${firstDataRow}:${col}${lastRow}`,
        rules: [
          {
            type: "colorScale",
            cfvo: [{ type: "min" }, { type: "num", value: 0 }, { type: "max" }],
            color: [
              { argb: "FFF8696B" }, // red = favors Actor B (male)
              { argb: "FFFFFFFF" }, // white = no effect
              { argb: "FF63BE7B" }, // green = favors Actor A (female)
            ],
            priority: 1,
          },
        ],
      });
    }

    const meanRow = sheet.addRow(["Column Mean:"]);
    meanRow.getCell(1).font = { bold: true, name: "Arial" };
    for (let col = 8; col <= WIDE_HEADERS.length; col++) {
      const letter = sheet.getColumn(col).letter;
      meanRow.getCell(col).value = { formula: `AVERAGE(${letter}${firstDataRow}:${letter}${lastRow})` };
      meanRow.getCell(col).font = { name: "Arial" };
    }
  }

  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 0 }];

  addAttributionLegendSheet(workbook);
  addGraphFeederSheets(workbook, rowsData, pairDerivedByKey, pairKey);

  return workbook;
}

/**
 * Data-only equivalents of the reference file's "Graphs by Model" /
 * "Combined Graphs" tabs — one row per scenario (the A-row's pair-level
 * values; RoleEffect/ActorPref are identical on both rows of a pair, so
 * there's no need to duplicate them here). No embedded chart objects:
 * ExcelJS can't write native Excel chart parts, so this ships the exact
 * table those charts were built from — select it and Insert → Chart in
 * Excel to get the same bar chart in a couple of clicks.
 */
function addGraphFeederSheets<R extends { vignetteId: string; first: AttributionCell }>(
  workbook: ExcelJS.Workbook,
  rowsData: R[],
  pairDerivedByKey: Map<string, PairDerived>,
  pairKey: (r: R) => string
) {
  const byPair = new Map<string, R[]>();
  for (const r of rowsData) {
    const key = pairKey(r);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push(r);
  }

  const scenarioLabel = (r: R) => r.vignetteId.replace(/-[AB]$/, "");

  const byModelSheet = workbook.addWorksheet("Graphs by Model");
  byModelSheet.columns = [
    { header: "scenario", width: 24 },
    { header: "domain", width: 15 },
    { header: "valence", width: 12 },
    { header: "GPT_RoleEffect", width: 16 },
    { header: "Gem_RoleEffect", width: 16 },
    { header: "GPT_ActorPref", width: 16 },
    { header: "Gem_ActorPref", width: 16 },
  ];
  byModelSheet.getRow(1).font = { bold: true, name: "Arial" };

  const combinedSheet = workbook.addWorksheet("Combined Graphs");
  combinedSheet.columns = [
    { header: "scenario", width: 24 },
    { header: "domain", width: 15 },
    { header: "valence", width: 12 },
    { header: "Combined_RoleEffect", width: 20 },
    { header: "Combined_ActorPref", width: 20 },
  ];
  combinedSheet.getRow(1).font = { bold: true, name: "Arial" };

  for (const [key, group] of byPair) {
    const rowA = group.find((r) => r.first.order_variant === "A");
    const rowB = group.find((r) => r.first.order_variant === "B");
    const rep = rowA ?? rowB;
    if (!rep) continue;
    const d = pairDerivedByKey.get(key);
    if (!d) continue;

    byModelSheet.addRow([
      scenarioLabel(rep),
      rep.first.domain,
      rep.first.valence,
      d.gptMean1st,
      d.gemMean1st,
      d.gptMeanActorA,
      d.gemMeanActorA,
    ]).font = { name: "Arial" };

    combinedSheet.addRow([
      scenarioLabel(rep),
      rep.first.domain,
      rep.first.valence,
      d.combinedMean1st,
      d.combinedMeanActorA,
    ]).font = { name: "Arial" };
  }
}
