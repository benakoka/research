import { NextRequest, NextResponse } from "next/server";
import { parseVignetteWorkbook, VignetteParseError } from "@/lib/vignettes";
import { saveVignetteSet, listVignetteSets } from "@/lib/store";
import { withApiErrorHandling } from "@/lib/apiError";
import { VignetteSet } from "@/lib/types";

export const GET = withApiErrorHandling(async () => {
  const sets = await listVignetteSets();
  // Don't ship full vignette_text for every row in the list view.
  const summaries = sets.map((s) => ({
    id: s.id,
    filename: s.filename,
    uploadedAt: s.uploadedAt,
    rowCount: s.rows.length,
  }));
  return NextResponse.json(summaries);
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  let parsed;
  try {
    parsed = await parseVignetteWorkbook(buffer);
  } catch (err) {
    if (err instanceof VignetteParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Could not parse the uploaded file. Is it a .xlsx in the template format?" },
      { status: 400 }
    );
  }

  const set: VignetteSet = {
    id: crypto.randomUUID(),
    filename: file.name,
    uploadedAt: new Date().toISOString(),
    rows: parsed.rows,
  };
  await saveVignetteSet(set);

  return NextResponse.json({ set, warnings: parsed.warnings });
});
