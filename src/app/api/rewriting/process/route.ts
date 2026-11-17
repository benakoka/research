import { NextRequest, NextResponse } from "next/server";
import { nextRunnableGenerationIndex } from "@/lib/rewriting";
import { executeGeneration } from "@/lib/rewritingExec";
import { withApiErrorHandling } from "@/lib/apiError";
import { RewritingChain } from "@/lib/types";

// Modest concurrency per batch across chains (chains are independent; within
// a chain, generations must run in order) — the client drives batching
// itself (see (dashboard)/rewriting/page.tsx, whose own BATCH_SIZE is the
// one that actually governs normal traffic — this is just a safety ceiling
// in case a client ever sends more). Stateless transform: given some chains
// + the prompt template/retry threshold, advance whichever chains have a
// runnable next generation and hand back the results. Promise.all waits for
// the slowest generation in the batch, so fewer concurrent ones means less
// chance one slow provider response (e.g. Gemini under real demand) holds
// up the rest.
const MAX_BATCH_SIZE = 6;

// §6: sent explicitly with every rewriting call rather than left unset
// (the provider's own default happens to be the same value, 1.0, but
// sending it explicitly means a future provider default change can't
// silently change this study's behavior). Not user-configurable — there's
// no reason this run should ever need to be anything else.
const TEMPERATURE = 1;

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
  retryThresholdEnabled: boolean;
  // §5's explicit retry budgets — stateless like everything else here, so
  // the client (which reads Settings) sends them on every call rather than
  // the route reading them from anywhere.
  apiErrorRetryLimit: number;
  refusalEmptyRetryLimit: number;
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
      const { generation, newAttempts } = await executeGeneration(
        body.promptTemplate,
        body.retryThresholdFraction,
        body.retryThresholdEnabled,
        body.apiErrorRetryLimit,
        body.refusalEmptyRetryLimit,
        TEMPERATURE,
        chain,
        genIndex,
        req.signal
      );
      const generations = [...chain.generations];
      generations[genIndex] = generation;
      return {
        ...chain,
        generations,
        attemptLog: [...chain.attemptLog, ...newAttempts],
        failedAtGeneration: generation.status === "error" ? genIndex : null,
      };
    })
  );

  return NextResponse.json({ chains: updatedChains });
});
