import { NextRequest, NextResponse } from "next/server";
import {
  getAttributionRun,
  getAttributionCells,
  saveAttributionCell,
  saveAttributionRun,
  getVignetteSet,
} from "@/lib/store";
import { executeAttributionCell } from "@/lib/attribution";
import { summarizeProgress } from "@/lib/progress";

// Modest concurrency per batch to avoid hammering provider rate limits (§5).
// The client polls this endpoint repeatedly; each call processes one batch
// and returns, which also keeps each invocation well under serverless
// function time limits for the 100+ call attribution runs.
const BATCH_SIZE = 6;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getAttributionRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const set = await getVignetteSet(run.vignetteSetId);
  if (!set) return NextResponse.json({ error: "Vignette set for this run no longer exists." }, { status: 404 });
  const rowById = new Map(set.rows.map((r) => [r.vignette_id, r]));

  const cells = await getAttributionCells(run);
  const pending = cells.filter((c) => c.status === "pending").slice(0, BATCH_SIZE);

  if (pending.length === 0) {
    const progress = summarizeProgress(cells.map((c) => c.status));
    if (progress.pending === 0 && progress.running === 0 && run.status !== "done") {
      await saveAttributionRun({ ...run, status: "done" });
    }
    return NextResponse.json({ progress, done: progress.pending === 0 && progress.running === 0 });
  }

  if (run.status === "pending") {
    await saveAttributionRun({ ...run, status: "running" });
  }

  // Mark as running before dispatch so concurrent polls don't double-process.
  await Promise.all(
    pending.map((c) => saveAttributionCell(run.id, { ...c, status: "running" }))
  );

  await Promise.all(
    pending.map(async (cell) => {
      const row = rowById.get(cell.vignette_id);
      if (!row) {
        await saveAttributionCell(run.id, {
          ...cell,
          status: "error",
          error: "Vignette row no longer exists in the uploaded set.",
        });
        return;
      }
      const result = await executeAttributionCell(run, cell, row);
      await saveAttributionCell(run.id, result);
    })
  );

  const updatedCells = await getAttributionCells(run);
  const progress = summarizeProgress(updatedCells.map((c) => c.status));
  const done = progress.pending === 0 && progress.running === 0;
  if (done && run.status !== "done") {
    await saveAttributionRun({ ...run, status: "done" });
  }

  return NextResponse.json({ progress, done });
}
