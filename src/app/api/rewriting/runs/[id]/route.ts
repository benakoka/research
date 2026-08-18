import { NextRequest, NextResponse } from "next/server";
import { getRewritingRun, getRewritingChains } from "@/lib/store";
import { summarizeProgress } from "@/lib/progress";
import { withApiErrorHandling } from "@/lib/apiError";

export const GET = withApiErrorHandling(async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const run = await getRewritingRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const chains = await getRewritingChains(run);
  const statuses = chains.flatMap((c) => c.generations.slice(1).map((g) => g.status));
  const progress = summarizeProgress(statuses);
  return NextResponse.json({ run, progress });
});
