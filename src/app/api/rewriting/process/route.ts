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
