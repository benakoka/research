import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings, getUsage } from "@/lib/store";
import { maskSecret } from "@/lib/mask";
import { summarizeCost } from "@/lib/cost";
import { getApiKey } from "@/lib/apiKeys";
import { Settings } from "@/lib/types";

export async function GET() {
  const settings = await getSettings();
  const usage = await getUsage();
  const costs = summarizeCost(usage, settings);

  return NextResponse.json({
    ...settings,
    // API keys are Vercel env vars (OPENAI_API_KEY / GEMINI_API_KEY), not
    // Settings-screen fields — read-only here, never editable via this API.
    openaiApiKeyMasked: maskSecret(getApiKey("GPT")),
    geminiApiKeyMasked: maskSecret(getApiKey("Gemini")),
    usage,
    costs,
  });
}

export async function POST(req: NextRequest) {
  let body: Partial<Settings>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Partial<Settings> = {};
  const passthroughFields: (keyof Settings)[] = [
    "gptModelSnapshot",
    "geminiModelSnapshot",
    "attributionPromptTemplate",
    "rewritingPromptTemplate",
    "defaultRepCount",
    "defaultWordCountTargets",
    "retryThresholdFraction",
    "gptPricing",
    "geminiPricing",
  ];
  for (const field of passthroughFields) {
    if (body[field] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[field] = body[field];
    }
  }

  const saved = await saveSettings(patch);
  return NextResponse.json({
    ...saved,
    openaiApiKeyMasked: maskSecret(getApiKey("GPT")),
    geminiApiKeyMasked: maskSecret(getApiKey("Gemini")),
  });
}
