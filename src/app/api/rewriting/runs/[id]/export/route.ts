import { NextRequest, NextResponse } from "next/server";
import { getRewritingRun, getRewritingChains } from "@/lib/store";
import { buildRewritingLongCsv, buildRewritingWideWorkbook } from "@/lib/export/rewriting";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format") ?? "long";

  const run = await getRewritingRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const chains = await getRewritingChains(run);

  if (format === "long") {
    const csv = buildRewritingLongCsv(chains);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rewriting_${id.slice(0, 8)}_long.csv"`,
      },
    });
  }

  if (format === "wide") {
    const workbook = buildRewritingWideWorkbook(chains);
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="rewriting_${id.slice(0, 8)}_wide.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown format. Use long or wide." }, { status: 400 });
}
