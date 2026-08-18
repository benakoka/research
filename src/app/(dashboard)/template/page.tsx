import fs from "node:fs";
import path from "node:path";
import { parseVignetteWorkbook, parseInstructionsSheet } from "@/lib/vignettes";

// Server-rendered preview of the blank vignette_upload_template.xlsx, read
// straight from the repo (templates/vignette_upload_template.xlsx — kept in
// sync with public/vignette_upload_template.xlsx by
// scripts/build-vignette-template.mjs) so someone can glance at the format
// before downloading it. No file upload happens here — this just displays
// the shipped template's own content.
export default async function TemplatePreviewPage() {
  const filePath = path.join(process.cwd(), "templates", "vignette_upload_template.xlsx");
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const [instructions, vignettes] = await Promise.all([
    parseInstructionsSheet(arrayBuffer),
    parseVignetteWorkbook(arrayBuffer),
  ]);

  const headers: (keyof (typeof vignettes.rows)[number])[] = [
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
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Vignette upload template</h1>
          <p className="mt-1 text-sm text-slate-600">
            This is exactly the file you get from the download link — a
            preview so you can check the format before filling it in. It
            ships with one illustrative example pair; replace it with real
            scenarios (always in A/B pairs) before uploading.
          </p>
        </div>
        <a
          href="/vignette_upload_template.xlsx"
          download
          className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Download .xlsx
        </a>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-semibold text-slate-900">Instructions tab</h2>
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <tbody>
              {instructions.map((row, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={
                        j === 0
                          ? "whitespace-nowrap py-2 pr-4 font-medium text-slate-800"
                          : "py-2 pr-4 text-slate-600"
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-1 font-semibold text-slate-900">Vignettes tab</h2>
        <p className="mb-4 text-xs text-slate-500">
          {vignettes.rows.length} row(s) shown below (formula-computed{" "}
          <code>vignette_id</code> values). <code>domain</code>,{" "}
          <code>valence</code>, and <code>order_variant</code> are
          dropdown-restricted in the real file.
        </p>
        <div className="overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-2 py-1 font-medium text-slate-600">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vignettes.rows.map((row) => (
                <tr key={row.vignette_id} className="border-t border-slate-100">
                  {headers.map((h) =>
                    h === "vignette_text" ? (
                      <td
                        key={h}
                        className="max-w-md truncate px-2 py-1 text-slate-700"
                        title={row.vignette_text}
                      >
                        {row.vignette_text}
                      </td>
                    ) : (
                      <td key={h} className="whitespace-nowrap px-2 py-1 text-slate-700">
                        {row[h]}
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
