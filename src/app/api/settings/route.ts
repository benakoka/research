import { NextResponse } from "next/server";
import { maskSecret } from "@/lib/mask";
import { getApiKey, isTestMode } from "@/lib/apiKeys";
import { withApiErrorHandling } from "@/lib/apiError";

// The only settings that ever touch the server are the API-key secrets
// (env vars) — everything else (model snapshots, prompt templates,
// defaults, pricing) lives in the browser's localStorage and never leaves
// the client except as request payloads to /api/attribution/process etc.
// This route just reports whether a key is configured, masked.
export const GET = withApiErrorHandling(async () => {
  return NextResponse.json({
    openaiApiKeyMasked: maskSecret(getApiKey("GPT")),
    geminiApiKeyMasked: maskSecret(getApiKey("Gemini")),
    // Reported per-slot — USE_CLAUDE_FOR_TESTING can cover just one of the
    // two (e.g. "gemini") while the other already has a real key.
    gptTestMode: isTestMode("GPT"),
    geminiTestMode: isTestMode("Gemini"),
  });
});
