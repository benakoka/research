import { NextRequest, NextResponse } from "next/server";
import { nextRunnableGenerationIndex } from "@/lib/rewriting";
import { executeGeneration } from "@/lib/rewritingExec";
import { withApiErrorHandling } from "@/lib/apiError";
import { RewritingChain, ModelProvider } from "@/lib/types";

// Modest concurrency per batch across chains (chains are independent; within
// a chain, generations must run in order) — the client drives batching
// itself (see (dashboard)/rewriting/page.tsx). Stateless transform: given
// some chains + the prompt template/retry threshold, advance whichever
// chains have a runnable next generation and hand back the results.
const MAX_BATCH_SIZE = 10;

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

  const usage: Record<ModelProvider, { calls: number; inputTokens: number; outputTokens: number }> = {
    GPT: { calls: 0, inputTokens: 0, outputTokens: 0 },
    Gemini: { calls: 0, inputTokens: 0, outputTokens: 0 },
  };

  const updatedChains = await Promise.all(
    runnable.map(async ({ chain, genIndex }) => {
      const { generation, usage: genUsage } = await executeGeneration(
        body.promptTemplate,
        body.retryThresholdFraction,
        chain,
        genIndex
      );
      if (genUsage) {
        usage[chain.model].calls += generation.retried ? 2 : 1;
        usage[chain.model].inputTokens += genUsage.inputTokens;
        usage[chain.model].outputTokens += genUsage.outputTokens;
      }
      const generations = [...chain.generations];
      generations[genIndex] = generation;
      return { ...chain, generations };
    })
  );

  return NextResponse.json({ chains: updatedChains, usage });
});
