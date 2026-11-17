import { NextRequest, NextResponse } from "next/server";
import {
  buildRewritingLongCsv,
  buildRewritingWideWorkbook,
  buildRewritingAsVignettesWorkbook,
} from "@/lib/export/rewriting";
import { buildRewritingAttemptLogCsv } from "@/lib/export/rewritingAttemptLog";
import { withApiErrorHandling } from "@/lib/apiError";
import { RewritingChain } from "@/lib/types";

// Stateless: the client sends the full set of chains it's accumulated (in
// localStorage) and gets a formatted file back.
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body: { chains: RewritingChain[]; format: "long" | "wide" | "vignettes" | "attempt_log" } = await req.json();
  if (!Array.isArray(body.chains) || body.chains.length === 0) {
    return NextResponse.json({ error: "chains must be a non-empty array." }, { status: 400 });
  }

  if (body.format === "long") {
    const csv = buildRewritingLongCsv(body.chains);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rewriting_successful_outputs.csv"`,
      },
    });
  }

  if (body.format === "attempt_log") {
    const csv = buildRewritingAttemptLogCsv(body.chains);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rewriting_attempt_log.csv"`,
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

  if (body.format === "vignettes") {
    const workbook = buildRewritingAsVignettesWorkbook(body.chains);
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="rewriting_as_vignettes.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown format. Use long, wide, vignettes, or attempt_log." }, { status: 400 });
});
