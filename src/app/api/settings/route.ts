import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings, getUsage } from "@/lib/store";
import { maskSecret } from "@/lib/mask";
import { summarizeCost } from "@/lib/cost";
import { Settings } from "@/lib/types";

export async function GET() {
  const settings = await getSettings();
  const usage = await getUsage();
  const costs = summarizeCost(usage, settings);

  const { openaiApiKey, geminiApiKey, ...rest } = settings;
  return NextResponse.json({
    ...rest,
    openaiApiKeyMasked: maskSecret(openaiApiKey),
    geminiApiKeyMasked: maskSecret(geminiApiKey),
    usage,
    costs,
  });
}

interface SettingsPatchBody
  extends Partial<
    Omit<Settings, "openaiApiKey" | "geminiApiKey">
  > {
  openaiApiKey?: string;
  geminiApiKey?: string;
  clearOpenaiApiKey?: boolean;
  clearGeminiApiKey?: boolean;
}

export async function POST(req: NextRequest) {
  let body: SettingsPatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Partial<Settings> = {};

  if (typeof body.openaiApiKey === "string" && body.openaiApiKey.length > 0) {
    patch.openaiApiKey = body.openaiApiKey;
  } else if (body.clearOpenaiApiKey) {
    patch.openaiApiKey = "";
  }

  if (typeof body.geminiApiKey === "string" && body.geminiApiKey.length > 0) {
    patch.geminiApiKey = body.geminiApiKey;
  } else if (body.clearGeminiApiKey) {
    patch.geminiApiKey = "";
  }

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
  const { openaiApiKey, geminiApiKey, ...rest } = saved;
  return NextResponse.json({
    ...rest,
    openaiApiKeyMasked: maskSecret(openaiApiKey),
    geminiApiKeyMasked: maskSecret(geminiApiKey),
  });
}
