import { NextRequest, NextResponse } from "next/server";
import { executeAttributionCell } from "@/lib/attributionExec";
import { withApiErrorHandling } from "@/lib/apiError";
import { AttributionCell } from "@/lib/types";

// Modest concurrency per batch to avoid hammering provider rate limits (§5).
// The client owns the run state and drives batching itself (see
// (dashboard)/attribution/page.tsx) — this route is a stateless transform:
// given some pending cells + the prompt template, call the models and hand
// back results. Nothing is persisted server-side, so this cap also protects
// against a single request running long enough to hit the serverless
// function's time limit.
const MAX_BATCH_SIZE = 10;

interface ProcessBody {
  cells: AttributionCell[];
  promptTemplate: string;
}

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body: ProcessBody = await req.json();
  if (!Array.isArray(body.cells) || body.cells.length === 0) {
    return NextResponse.json({ error: "cells must be a non-empty array." }, { status: 400 });
  }
  if (!body.promptTemplate) {
    return NextResponse.json({ error: "promptTemplate is required." }, { status: 400 });
  }

  const batch = body.cells.slice(0, MAX_BATCH_SIZE);
  const results = await Promise.all(batch.map((cell) => executeAttributionCell(body.promptTemplate, cell)));

  return NextResponse.json({ cells: results });
});
