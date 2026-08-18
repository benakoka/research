import { NextRequest, NextResponse } from "next/server";
import { buildAttributionLongCsv, buildAttributionWideWorkbook } from "@/lib/export/attribution";
import { withApiErrorHandling } from "@/lib/apiError";
import { AttributionCell } from "@/lib/types";

// Stateless: the client sends the full set of cells it's accumulated (in
// localStorage) and gets a formatted file back. Nothing is read from or
// written to a server store — this is a pure transform.
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body: { cells: AttributionCell[]; format: "long" | "wide" } = await req.json();
  if (!Array.isArray(body.cells) || body.cells.length === 0) {
    return NextResponse.json({ error: "cells must be a non-empty array." }, { status: 400 });
  }

  if (body.format === "long") {
    const csv = buildAttributionLongCsv(body.cells);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attribution_long.csv"`,
      },
    });
  }

  if (body.format === "wide") {
    const workbook = buildAttributionWideWorkbook(body.cells);
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="attribution_wide.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown format. Use long or wide." }, { status: 400 });
});
