import { NextRequest, NextResponse } from "next/server";
import {
  getAttributionRun,
  getAttributionCell,
  saveAttributionCell,
  getVignetteSet,
} from "@/lib/store";
import { executeAttributionCell } from "@/lib/attribution";

// Allows re-running a single failed cell without re-running the whole batch (§3).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cellId: string }> }
) {
  const { id, cellId } = await params;
  const run = await getAttributionRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const cell = await getAttributionCell(run.id, cellId);
  if (!cell) return NextResponse.json({ error: "Cell not found." }, { status: 404 });

  const set = await getVignetteSet(run.vignetteSetId);
  const row = set?.rows.find((r) => r.vignette_id === cell.vignette_id);
  if (!row) {
    return NextResponse.json({ error: "Vignette row no longer exists in the uploaded set." }, { status: 404 });
  }

  await saveAttributionCell(run.id, { ...cell, status: "running" });
  const result = await executeAttributionCell(run, cell, row);
  await saveAttributionCell(run.id, result);

  return NextResponse.json(result);
}
