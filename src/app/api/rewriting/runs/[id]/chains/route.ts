import { NextRequest, NextResponse } from "next/server";
import { getRewritingRun, getRewritingChains } from "@/lib/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getRewritingRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const chains = await getRewritingChains(run);
  return NextResponse.json(chains);
}
