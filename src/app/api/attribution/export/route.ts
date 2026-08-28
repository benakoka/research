import { NextRequest, NextResponse } from "next/server";
import { buildAttributionWideWorkbook } from "@/lib/export/attribution";
import { withApiErrorHandling } from "@/lib/apiError";
import { AttributionCell } from "@/lib/types";

// Stateless: the client sends the full set of cells it's accumulated (in
// localStorage) and gets a formatted file back. Nothing is read from or
// written to a server store — this is a pure transform.
//
// One export format now — the wide XLSX (with its own "Raw Data" tab
// carrying every individual model call). There used to also be a
// standalone long-format CSV; it was folded into that tab instead of kept
// as a second download.
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body: { cells: AttributionCell[] } = await req.json();
  if (!Array.isArray(body.cells) || body.cells.length === 0) {
    return NextResponse.json({ error: "cells must be a non-empty array." }, { status: 400 });
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
