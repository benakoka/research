import { NextRequest, NextResponse } from "next/server";
import { getAttributionRun, getAttributionCells } from "@/lib/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getAttributionRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const cells = await getAttributionCells(run);
  return NextResponse.json(cells);
}
