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
