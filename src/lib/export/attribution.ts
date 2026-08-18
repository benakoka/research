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
  "raw_response",
  "timestamp",
] as const;

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
    c.raw_response,
    c.timestamp,
  ]);
  return toCsv([...LONG_HEADERS], rows);
}

const WIDE_HEADERS = [
  "vignette_id",
  "domain",
  "valence",
  "order_variant",
  "female_name",
  "male_name",
  "vignette_text",
  "GPT_woman_first",
  "GPT_man_first",
  "GPT_net_female_favor",
  "Gemini_woman_first",
  "Gemini_man_first",
  "Gemini_net_female_favor",
] as const;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Wide-format workbook, one row per vignette_id, matching the layout in
 * example_output_formats.xlsx ("Attribution (wide view)"). If rep count > 1,
 * each model/direction cell is averaged across reps rather than silently
 * dropping data (§3) — repCount > 1 is flagged separately in the run UI.
 */
export function buildAttributionWideWorkbook(cells: AttributionCell[]): ExcelJS.Workbook {
  const byVignette = new Map<string, AttributionCell[]>();
  for (const c of cells) {
    if (!byVignette.has(c.vignette_id)) byVignette.set(c.vignette_id, []);
    byVignette.get(c.vignette_id)!.push(c);
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Attribution (wide view)");
  sheet.addRow([...WIDE_HEADERS]);
  sheet.getRow(1).font = { bold: true };

  const netFavorCols = ["J", "M"] as const; // GPT_net_female_favor, Gemini_net_female_favor

  for (const [vignetteId, group] of byVignette) {
    const first = group[0];
    const ratingsFor = (model: "GPT" | "Gemini", direction: "as_written" | "flipped") =>
      group
        .filter((c) => c.model === model && c.scale_direction === direction && c.rating !== null)
        .map((c) => c.rating as number);

    const gptWoman = average(ratingsFor("GPT", "as_written"));
    const gptMan = average(ratingsFor("GPT", "flipped"));
    const gemWoman = average(ratingsFor("Gemini", "as_written"));
    const gemMan = average(ratingsFor("Gemini", "flipped"));

    const gptNet = gptWoman !== null && gptMan !== null ? (gptWoman - gptMan) / 2 : null;
    const gemNet = gemWoman !== null && gemMan !== null ? (gemWoman - gemMan) / 2 : null;

    sheet.addRow([
      vignetteId,
      first.domain,
      first.valence,
      first.order_variant,
      first.female_name,
      first.male_name,
      first.vignette_text,
      gptWoman,
      gptMan,
      gptNet,
      gemWoman,
      gemMan,
      gemNet,
    ]);
  }

  const lastRow = sheet.rowCount;
  if (lastRow >= 2) {
    for (const col of netFavorCols) {
      sheet.addConditionalFormatting({
        ref: `${col}2:${col}${lastRow}`,
        rules: [
          {
            type: "colorScale",
            cfvo: [{ type: "min" }, { type: "num", value: 0 }, { type: "max" }],
            color: [
              { argb: "FFF8696B" }, // red = favored man
              { argb: "FFFFFFFF" }, // white = neutral
              { argb: "FF63BE7B" }, // green = favored woman
            ],
            priority: 1,
          },
        ],
      });
    }
  }

  sheet.columns.forEach((col) => {
    col.width = 18;
  });
  const textCol = sheet.getColumn(7);
  textCol.width = 60;

  return workbook;
}
