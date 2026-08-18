import { NextRequest, NextResponse } from "next/server";
import { getAttributionRun, getAttributionCells } from "@/lib/store";
import { summarizeProgress } from "@/lib/progress";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getAttributionRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const cells = await getAttributionCells(run);
  const progress = summarizeProgress(cells.map((c) => c.status));
  return NextResponse.json({ run, progress });
}
