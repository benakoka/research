import { NextRequest, NextResponse } from "next/server";
import {
  getVignetteSet,
  saveRewritingRun,
  saveRewritingChain,
  listRewritingRuns,
  getSettings,
} from "@/lib/store";
import { buildRewritingChains } from "@/lib/rewriting";
import { RewritingRun } from "@/lib/types";

export async function GET() {
  const runs = await listRewritingRuns();
  return NextResponse.json(runs);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const vignetteSetId: string | undefined = body.vignetteSetId;
  if (!vignetteSetId) {
    return NextResponse.json({ error: "vignetteSetId is required." }, { status: 400 });
  }

  const set = await getVignetteSet(vignetteSetId);
  if (!set) {
    return NextResponse.json({ error: "Vignette set not found." }, { status: 404 });
  }

  const settings = await getSettings();
  const promptTemplate: string = body.promptTemplate ?? settings.rewritingPromptTemplate;
  const wordCountTargets = body.wordCountTargets ?? settings.defaultWordCountTargets;
  const retryThresholdFraction: number = body.retryThresholdFraction ?? settings.retryThresholdFraction;

  const run: RewritingRun = {
    id: crypto.randomUUID(),
    vignetteSetId,
    createdAt: new Date().toISOString(),
    promptTemplate,
    gptModelSnapshot: settings.gptModelSnapshot,
    geminiModelSnapshot: settings.geminiModelSnapshot,
    retryThresholdFraction,
    chainIds: [],
    status: "pending",
  };

  // For each row × 2 models = independent chains; scales with whatever the
  // sheet contains, never hardcoded (§4).
  const chains = buildRewritingChains(
    set.rows,
    wordCountTargets,
    settings.gptModelSnapshot,
    settings.geminiModelSnapshot
  );
  run.chainIds = chains.map((c) => c.id);

  await Promise.all(chains.map((c) => saveRewritingChain(run.id, c)));
  await saveRewritingRun(run);

  return NextResponse.json(run);
}
