import { NextRequest, NextResponse } from "next/server";
import { executeAttributionCell } from "@/lib/attributionExec";
import { withApiErrorHandling } from "@/lib/apiError";
import { AttributionCell } from "@/lib/types";

// Modest concurrency per batch to avoid hammering provider rate limits (§5).
// The client owns the run state and drives batching itself (see
// (dashboard)/attribution/page.tsx, whose own BATCH_SIZE is the one that
// actually governs normal traffic — this is just a safety ceiling in case
// a client ever sends more). Nothing is persisted server-side, so this cap
// also protects against a single request running long enough to hit the
// serverless function's time limit — Promise.all waits for the slowest
// cell in the batch, so fewer concurrent cells means less chance one slow
// provider response (e.g. Gemini under real demand) holds up the rest.
const MAX_BATCH_SIZE = 6;

// NOT setting an explicit `maxDuration` here on purpose — a prior attempt at
// this (`export const maxDuration = 60`) caused every request to this route
// to crash immediately at the platform level (Vercel's generic error page,
// not one of our own error responses — withApiErrorHandling below can't even
// catch it, since the failure isn't inside the handler). Most likely cause:
// an account not on Vercel's newer Fluid Compute pricing has a much lower,
// non-configurable hard cap (historically 10s on legacy Hobby), and an
// explicit maxDuration exceeding that gets rejected outright rather than
// clamped. If you confirm (Vercel dashboard → the deployment's Runtime Logs)
// that your account supports a higher duration, re-adding this is safe and
// worth doing — see lib/models/index.ts's MAX_ATTEMPTS comment for why a
// slow/overloaded batch might need more room than the platform default.
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
