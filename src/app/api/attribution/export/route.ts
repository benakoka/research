import { NextRequest, NextResponse } from "next/server";
import { buildAttributionWideWorkbook } from "@/lib/export/attribution";
import { buildAttributionAnalysisCsv } from "@/lib/export/attributionAnalysisCsv";
import { withApiErrorHandling } from "@/lib/apiError";
import { AttributionCell } from "@/lib/types";

// Stateless: the client sends the full set of cells it's accumulated (in
// localStorage) and gets a formatted file back. Nothing is read from or
// written to a server store — this is a pure transform.
//
// Two export formats: the wide XLSX (default, with its own "Raw Data" tab
// carrying every individual model call — there used to also be a
// standalone long-format CSV; it was folded into that tab instead of kept
// as a second download), and the "analysis dataset" CSV
// (lib/export/attributionAnalysisCsv.ts), which matches the column schema
// of a parallel human-rater study's export so AI rows can be analyzed
// alongside human ones.
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body: { cells: AttributionCell[]; format?: "xlsx" | "analysis_csv" } = await req.json();
  if (!Array.isArray(body.cells) || body.cells.length === 0) {
    return NextResponse.json({ error: "cells must be a non-empty array." }, { status: 400 });
  }

  if (body.format === "analysis_csv") {
    const csv = buildAttributionAnalysisCsv(body.cells);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attribution_analysis_dataset.csv"`,
      },
    });
  }

  const workbook = await buildAttributionWideWorkbook(body.cells);
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="attribution.xlsx"`,
    },
  });
});
