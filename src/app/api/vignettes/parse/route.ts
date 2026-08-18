import { NextRequest, NextResponse } from "next/server";
import { parseVignetteWorkbook, VignetteParseError } from "@/lib/vignettes";
import { withApiErrorHandling } from "@/lib/apiError";

// Stateless: parses the uploaded xlsx and hands the rows straight back.
// Nothing is written down server-side — the client holds onto the parsed
// rows (in memory + localStorage) for as long as it needs them.
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  try {
    const parsed = await parseVignetteWorkbook(buffer);
    return NextResponse.json({
      filename: file.name,
      uploadedAt: new Date().toISOString(),
      rows: parsed.rows,
      warnings: parsed.warnings,
    });
  } catch (err) {
    if (err instanceof VignetteParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Could not parse the uploaded file. Is it a .xlsx in the template format?" },
      { status: 400 }
    );
  }
});
