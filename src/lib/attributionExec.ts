// Server-only: this pulls in lib/models (fetch calls to provider APIs) and
// lib/apiKeys (reads server env vars for secrets). Only import this from
// API routes, never from a client component — see lib/attribution.ts for
// the pure, client-safe half of this module (building cells, parsing
// ratings) that the browser is allowed to import directly.
import { AttributionCell } from "./types";
import { callModel, ModelCallError } from "./models";
import { getApiKey } from "./apiKeys";
import { buildAttributionPrompt, parseRating } from "./attribution";

export interface AttributionExecutionResult {
  cell: AttributionCell;
  usage: { inputTokens: number; outputTokens: number } | null; // null when the call errored
}

/** Executes one cell: builds the prompt, calls the model, parses the rating. */
export async function executeAttributionCell(
  promptTemplate: string,
  cell: AttributionCell
): Promise<AttributionExecutionResult> {
  const apiKey = getApiKey(cell.model);

  const filledPrompt = buildAttributionPrompt(promptTemplate, cell.plus50_name, cell.minus50_name);
  // Story sent alongside the filled prompt in one message (§3).
  const combined = `${cell.vignette_text}\n\n${filledPrompt}`;

  try {
    const result = await callModel(cell.model, apiKey, cell.model_snapshot, combined);
    const { rating, parseError } = parseRating(result.text);
    return {
      cell: {
        ...cell,
        status: "done",
        rating,
        raw_response: result.text,
        parse_error: parseError,
        error: null,
        timestamp: new Date().toISOString(),
      },
      usage: result.usage,
    };
  } catch (err) {
    const message = err instanceof ModelCallError ? err.message : "Unknown error.";
    return {
      cell: {
        ...cell,
        status: "error",
        error: message,
        timestamp: new Date().toISOString(),
      },
      usage: null,
    };
  }
}
