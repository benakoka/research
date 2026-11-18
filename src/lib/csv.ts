/** Minimal RFC 4180 CSV writer — quotes any field containing a comma, quote, or newline. */
export function toCsvRow(fields: (string | number | null | undefined)[]): string {
  return fields
    .map((f) => {
      const s = f === null || f === undefined ? "" : String(f);
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(",");
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [toCsvRow(header), ...rows.map(toCsvRow)].join("\r\n") + "\r\n";
}

/**
 * Minimal RFC 4180 CSV reader — the exact inverse of toCsv/toCsvRow above
 * (handles quoted fields containing commas/newlines, and doubled "" as an
 * escaped quote). Used for re-importing a file this app itself exported
 * (e.g. resuming a run from a previously-downloaded attempt log), not for
 * arbitrary third-party CSVs — it doesn't try to handle every CSV dialect,
 * only the one toCsv produces.
 */
export function parseCsv(text: string): string[][] {
  if (text.trim() === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") {
      continue; // swallow — \n (below) ends the row either way
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A trailing blank line (toCsv always ends with \r\n) produces one final
  // all-empty single-field row — drop it rather than treating it as data.
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
  }
  return rows;
}
