import { NextRequest, NextResponse } from "next/server";
import { buildRewritingLongCsv, buildRewritingWideWorkbook } from "@/lib/export/rewriting";
import { withApiErrorHandling } from "@/lib/apiError";
import { RewritingChain } from "@/lib/types";

// Stateless: the client sends the full set of chains it's accumulated (in
// localStorage) and gets a formatted file back.
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body: { chains: RewritingChain[]; format: "long" | "wide" } = await req.json();
  if (!Array.isArray(body.chains) || body.chains.length === 0) {
    return NextResponse.json({ error: "chains must be a non-empty array." }, { status: 400 });
  }

  if (body.format === "long") {
    const csv = buildRewritingLongCsv(body.chains);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rewriting_long.csv"`,
      },
    });
  }

  if (body.format === "wide") {
    const workbook = buildRewritingWideWorkbook(body.chains);
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="rewriting_wide.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown format. Use long or wide." }, { status: 400 });
});
