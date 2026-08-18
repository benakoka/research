import { NextRequest, NextResponse } from "next/server";
import { getRewritingRun, getRewritingChain, saveRewritingChain } from "@/lib/store";
import { executeGeneration } from "@/lib/rewriting";

// Allows re-running a single failed/miscompliant generation without
// restarting the whole chain (§5). Re-running generation N re-derives its
// input from generation N-1's *current* text, same as the original run.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; chainId: string; gen: string }> }
) {
  const { id, chainId, gen } = await params;
  const genIndex = Number(gen);
  if (!Number.isInteger(genIndex) || genIndex < 1 || genIndex > 5) {
    return NextResponse.json({ error: "generation must be 1-5." }, { status: 400 });
  }

  const run = await getRewritingRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const chain = await getRewritingChain(run.id, chainId);
  if (!chain) return NextResponse.json({ error: "Chain not found." }, { status: 404 });

  if (chain.generations[genIndex - 1].status !== "done") {
    return NextResponse.json(
      { error: `Generation ${genIndex - 1} must be done before retrying generation ${genIndex}.` },
      { status: 400 }
    );
  }

  const gens = [...chain.generations];
  gens[genIndex] = { ...gens[genIndex], status: "running" };
  await saveRewritingChain(run.id, { ...chain, generations: gens, status: "running" });

  const result = await executeGeneration(run, chain, genIndex);
  const finalGens = [...gens];
  finalGens[genIndex] = result;
  const status = finalGens[5].status === "done" ? "done" : "running";
  await saveRewritingChain(run.id, { ...chain, generations: finalGens, status });

  return NextResponse.json(result);
}
