import { NextRequest, NextResponse } from "next/server";
import { getVignetteSet, saveAttributionRun, saveAttributionCell, listAttributionRuns } from "@/lib/store";
import { getSettings } from "@/lib/store";
import { buildAttributionCells } from "@/lib/attribution";
import { AttributionRun } from "@/lib/types";

export async function GET() {
  const runs = await listAttributionRuns();
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
  const repCount: number = body.repCount ?? settings.defaultRepCount;
  const promptTemplate: string = body.promptTemplate ?? settings.attributionPromptTemplate;

  const run: AttributionRun = {
    id: crypto.randomUUID(),
    vignetteSetId,
    createdAt: new Date().toISOString(),
    promptTemplate,
    repCount,
    gptModelSnapshot: settings.gptModelSnapshot,
    geminiModelSnapshot: settings.geminiModelSnapshot,
    cellIds: [],
    status: "pending",
  };

  // Don't hardcode row/scenario count anywhere — read it from the parsed sheet (§3).
  const cells = buildAttributionCells(
    set.rows,
    repCount,
    settings.gptModelSnapshot,
    settings.geminiModelSnapshot
  );
  run.cellIds = cells.map((c) => c.id);

  await Promise.all(cells.map((c) => saveAttributionCell(run.id, c)));
  await saveAttributionRun(run);

  return NextResponse.json(run);
}
