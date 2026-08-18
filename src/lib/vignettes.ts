import ExcelJS from "exceljs";
import { Domain, Valence, OrderVariant, VignetteRow } from "./types";

const REQUIRED_HEADERS = [
  "vignette_id",
  "domain",
  "valence",
  "scenario_number",
  "order_variant",
  "actor_first_name",
  "actor_second_name",
  "female_name",
  "male_name",
  "vignette_text",
] as const;

const VALID_DOMAINS = new Set<Domain>(["leadership", "brilliance", "rationality"]);
const VALID_VALENCES = new Set<Valence>(["credit", "blame"]);
const VALID_ORDER_VARIANTS = new Set<OrderVariant>(["A", "B"]);

export class VignetteParseError extends Error {}

/** Extracts plain text from any ExcelJS cell value, including formula results and rich text. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  // Formula cell: { formula, result } — read the computed value, not the formula string.
  if (typeof value === "object" && "result" in value) {
    return cellText((value as { result: ExcelJS.CellValue }).result);
  }
  // Rich text: { richText: [{ text }, ...] }
  if (typeof value === "object" && "richText" in value) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (value as any).richText.map((r: { text: string }) => r.text).join("");
  }
  return String(value);
}

export interface ParsedVignettes {
  rows: VignetteRow[];
  warnings: string[];
}

/**
 * Parses an uploaded vignette_upload_template.xlsx-shaped workbook. Reads the
 * `Vignettes` sheet, header row 1, data from row 2, by column header name
 * (not position) — the template can gain columns later without breaking
 * older uploads (§3). Trusts the domain/valence/order_variant dropdown value
 * set rather than doing its own free-text validation of those columns,
 * but still surfaces a clear error if a value falls outside that set (e.g.
 * a hand-edited row) rather than silently misparsing it.
 */
export async function parseVignetteWorkbook(buffer: ArrayBuffer): Promise<ParsedVignettes> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.getWorksheet("Vignettes");
  if (!sheet) {
    throw new VignetteParseError(
      `Workbook has no "Vignettes" sheet. Found: ${workbook.worksheets
        .map((s) => s.name)
        .join(", ")}`
    );
  }

  const headerRow = sheet.getRow(1);
  const headerToCol = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const header = cellText(cell.value).trim();
    if (header) headerToCol.set(header, colNumber);
  });

  const missing = REQUIRED_HEADERS.filter((h) => !headerToCol.has(h));
  if (missing.length > 0) {
    throw new VignetteParseError(
      `Vignettes sheet is missing required column header(s): ${missing.join(", ")}`
    );
  }

  const col = (header: (typeof REQUIRED_HEADERS)[number]) => headerToCol.get(header)!;

  const rows: VignetteRow[] = [];
  const warnings: string[] = [];
  const seenIds = new Map<string, number>();

  const lastRow = sheet.lastRow?.number ?? 1;
  for (let r = 2; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    // Skip fully blank rows (trailing empty rows are common in spreadsheets).
    const isBlank = REQUIRED_HEADERS.every((h) => cellText(row.getCell(col(h)).value).trim() === "");
    if (isBlank) continue;

    const get = (h: (typeof REQUIRED_HEADERS)[number]) => cellText(row.getCell(col(h)).value).trim();

    const vignette_id = get("vignette_id");
    const domainRaw = get("domain").toLowerCase() as Domain;
    const valenceRaw = get("valence").toLowerCase() as Valence;
    const orderRaw = get("order_variant").toUpperCase() as OrderVariant;
    const scenarioRaw = get("scenario_number");

    if (!vignette_id) {
      throw new VignetteParseError(`Row ${r}: vignette_id is empty.`);
    }
    if (!VALID_DOMAINS.has(domainRaw)) {
      throw new VignetteParseError(
        `Row ${r} (${vignette_id}): domain "${get("domain")}" is not one of leadership/brilliance/rationality.`
      );
    }
    if (!VALID_VALENCES.has(valenceRaw)) {
      throw new VignetteParseError(
        `Row ${r} (${vignette_id}): valence "${get("valence")}" is not one of credit/blame.`
      );
    }
    if (!VALID_ORDER_VARIANTS.has(orderRaw)) {
      throw new VignetteParseError(
        `Row ${r} (${vignette_id}): order_variant "${get("order_variant")}" is not A or B.`
      );
    }
    const scenario_number = Number(scenarioRaw);
    if (!Number.isFinite(scenario_number)) {
      throw new VignetteParseError(
        `Row ${r} (${vignette_id}): scenario_number "${scenarioRaw}" is not a number.`
      );
    }

    const actor_first_name = get("actor_first_name");
    const actor_second_name = get("actor_second_name");
    const female_name = get("female_name");
    const male_name = get("male_name");
    const vignette_text = get("vignette_text");

    if (!female_name || !male_name) {
      throw new VignetteParseError(
        `Row ${r} (${vignette_id}): female_name and male_name must both be set.`
      );
    }
    if (!vignette_text) {
      throw new VignetteParseError(`Row ${r} (${vignette_id}): vignette_text is empty.`);
    }

    if (seenIds.has(vignette_id)) {
      throw new VignetteParseError(
        `Duplicate vignette_id "${vignette_id}" at rows ${seenIds.get(vignette_id)} and ${r}.`
      );
    }
    seenIds.set(vignette_id, r);

    rows.push({
      vignette_id,
      domain: domainRaw,
      valence: valenceRaw,
      scenario_number,
      order_variant: orderRaw,
      actor_first_name,
      actor_second_name,
      female_name,
      male_name,
      vignette_text,
    });
  }

  if (rows.length === 0) {
    throw new VignetteParseError("No data rows found in the Vignettes sheet.");
  }

  // Soft check: rows should come in A/B pairs sharing domain+valence+scenario_number.
  const pairKey = (row: VignetteRow) => `${row.domain}::${row.valence}::${row.scenario_number}`;
  const pairCounts = new Map<string, number>();
  for (const row of rows) {
    pairCounts.set(pairKey(row), (pairCounts.get(pairKey(row)) ?? 0) + 1);
  }
  for (const [key, count] of pairCounts) {
    if (count !== 2) {
      warnings.push(
        `Scenario "${key}" has ${count} row(s), expected 2 (an A/B pair). Check the upload.`
      );
    }
  }

  return { rows, warnings };
}
