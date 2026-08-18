import { NextRequest, NextResponse } from "next/server";
import { getAttributionRun, getAttributionCells, getVignetteSet } from "@/lib/store";
import { buildAttributionLongCsv, buildAttributionWideWorkbook } from "@/lib/export/attribution";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format") ?? "long";

  const run = await getAttributionRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const cells = await getAttributionCells(run);

  if (format === "long") {
    const csv = buildAttributionLongCsv(cells);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attribution_${id.slice(0, 8)}_long.csv"`,
      },
    });
  }

  if (format === "wide") {
    const set = await getVignetteSet(run.vignetteSetId);
    if (!set) return NextResponse.json({ error: "Vignette set no longer exists." }, { status: 404 });
    const workbook = buildAttributionWideWorkbook(cells, set);
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="attribution_${id.slice(0, 8)}_wide.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown format. Use long or wide." }, { status: 400 });
}
