import { Settings, UsageCounters, ModelProvider } from "./types";

export interface CostSummary {
  model: ModelProvider;
  snapshot: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** null when no pricing has been entered in settings for this model. */
  estimatedCostUsd: number | null;
}

/**
 * Rough, non-authoritative cost estimate for the settings-screen cost
 * visibility display (§5/§2). There is intentionally no spend cap — Ben
 * manages budget in the provider billing dashboards directly.
 */
export function summarizeCost(usage: UsageCounters, settings: Settings): CostSummary[] {
  const models: { model: ModelProvider; snapshot: string; pricing: Settings["gptPricing"] }[] = [
    { model: "GPT", snapshot: settings.gptModelSnapshot, pricing: settings.gptPricing },
    { model: "Gemini", snapshot: settings.geminiModelSnapshot, pricing: settings.geminiPricing },
  ];

  return models.map(({ model, snapshot, pricing }) => {
    const calls = usage.calls[model] ?? 0;
    const inputTokens = usage.inputTokens[model] ?? 0;
    const outputTokens = usage.outputTokens[model] ?? 0;
    const hasPricing = pricing.inputPerMillion > 0 || pricing.outputPerMillion > 0;
    const estimatedCostUsd = hasPricing
      ? (inputTokens / 1_000_000) * pricing.inputPerMillion +
        (outputTokens / 1_000_000) * pricing.outputPerMillion
      : null;
    return { model, snapshot, calls, inputTokens, outputTokens, estimatedCostUsd };
  });
}
