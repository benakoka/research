import { NextRequest, NextResponse } from "next/server";
import { getVignetteSet } from "@/lib/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const set = await getVignetteSet(id);
  if (!set) {
    return NextResponse.json({ error: "Vignette set not found." }, { status: 404 });
  }
  return NextResponse.json(set);
}
