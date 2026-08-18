import { NextRequest, NextResponse } from "next/server";
import {
  getRewritingRun,
  getRewritingChains,
  saveRewritingChain,
  saveRewritingRun,
} from "@/lib/store";
import { executeGeneration, nextRunnableGenerationIndex } from "@/lib/rewriting";
import { summarizeProgress } from "@/lib/progress";
import { withApiErrorHandling } from "@/lib/apiError";
import { RewritingChain } from "@/lib/types";

// Modest concurrency per batch across chains (chains are independent; within
// a chain, generations must run in order) — avoids hammering provider rate
// limits while keeping each invocation short (§5).
const BATCH_SIZE = 6;

function deriveChainStatus(chain: RewritingChain): RewritingChain["status"] {
  if (chain.generations[5].status === "done") return "done";
  if (chain.generations.some((g) => g.status === "running")) return "running";
  if (chain.generations.slice(1).some((g) => g.status !== "pending")) return "running";
  return "pending";
}

export const POST = withApiErrorHandling(async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const run = await getRewritingRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const chains = await getRewritingChains(run);

  const runnable = chains
    .map((chain) => ({ chain, genIndex: nextRunnableGenerationIndex(chain) }))
    .filter((x): x is { chain: RewritingChain; genIndex: number } => x.genIndex !== null)
    .slice(0, BATCH_SIZE);

  const statuses = chains.flatMap((c) => c.generations.slice(1).map((g) => g.status));
  const overallDone = statuses.every((s) => s === "done" || s === "error");

  if (runnable.length === 0) {
    const progress = summarizeProgress(statuses);
    if (overallDone && run.status !== "done") {
      await saveRewritingRun({ ...run, status: "done" });
    }
    return NextResponse.json({ progress, done: overallDone });
  }

  if (run.status === "pending") {
    await saveRewritingRun({ ...run, status: "running" });
  }

  // Mark as running before dispatch so concurrent polls don't double-process.
  await Promise.all(
    runnable.map(({ chain, genIndex }) => {
      const gens = [...chain.generations];
      gens[genIndex] = { ...gens[genIndex], status: "running" };
      return saveRewritingChain(run.id, { ...chain, generations: gens, status: "running" });
    })
  );

  await Promise.all(
    runnable.map(async ({ chain, genIndex }) => {
      const result = await executeGeneration(run, chain, genIndex);
      const gens = [...chain.generations];
      gens[genIndex] = result;
      const updated = { ...chain, generations: gens };
      await saveRewritingChain(run.id, { ...updated, status: deriveChainStatus(updated) });
    })
  );

  const updatedChains = await getRewritingChains(run);
  const updatedStatuses = updatedChains.flatMap((c) => c.generations.slice(1).map((g) => g.status));
  const progress = summarizeProgress(updatedStatuses);
  const done = updatedStatuses.every((s) => s === "done" || s === "error");
  if (done && run.status !== "done") {
    await saveRewritingRun({ ...run, status: "done" });
  }

  return NextResponse.json({ progress, done });
});
