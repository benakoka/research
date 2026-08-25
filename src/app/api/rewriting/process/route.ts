import { NextRequest, NextResponse } from "next/server";
import { nextRunnableGenerationIndex } from "@/lib/rewriting";
import { executeGeneration } from "@/lib/rewritingExec";
import { withApiErrorHandling } from "@/lib/apiError";
import { RewritingChain } from "@/lib/types";

// Modest concurrency per batch across chains (chains are independent; within
// a chain, generations must run in order) — the client drives batching
// itself (see (dashboard)/rewriting/page.tsx). Stateless transform: given
// some chains + the prompt template/retry threshold, advance whichever
// chains have a runnable next generation and hand back the results.
const MAX_BATCH_SIZE = 10;

// A batch of concurrent generations (Promise.all below) each independently
// retry on transient errors (see lib/models/index.ts) — with several
// generations hitting that at once, this route's total time can exceed
// Vercel's short platform default with no explicit config, which silently
// kills the request rather than returning an error (the run just looks
// hung). 60s is the max Vercel allows without a paid-plan-specific config,
// and gives real headroom over the realistic worst case per generation
// after the retry-budget fix (single-digit seconds — see
// lib/models/index.ts's MAX_ATTEMPTS comment).
export const maxDuration = 60;

interface ProcessBody {
  chains: RewritingChain[];
  promptTemplate: string;
  retryThresholdFraction: number;
}

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body: ProcessBody = await req.json();
  if (!Array.isArray(body.chains) || body.chains.length === 0) {
    return NextResponse.json({ error: "chains must be a non-empty array." }, { status: 400 });
  }
  if (!body.promptTemplate) {
    return NextResponse.json({ error: "promptTemplate is required." }, { status: 400 });
  }

  const runnable = body.chains
    .map((chain) => ({ chain, genIndex: nextRunnableGenerationIndex(chain) }))
    .filter((x): x is { chain: RewritingChain; genIndex: number } => x.genIndex !== null)
    .slice(0, MAX_BATCH_SIZE);

  const updatedChains = await Promise.all(
    runnable.map(async ({ chain, genIndex }) => {
      const generation = await executeGeneration(body.promptTemplate, body.retryThresholdFraction, chain, genIndex);
      const generations = [...chain.generations];
      generations[genIndex] = generation;
      return { ...chain, generations };
    })
  );

  return NextResponse.json({ chains: updatedChains });
});
