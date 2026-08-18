// Server-only: this pulls in lib/models (fetch calls to provider APIs) and
// lib/apiKeys (reads server env vars for secrets). Only import this from
// API routes, never from a client component — see lib/attribution.ts for
// the pure, client-safe half of this module (building cells, parsing
// ratings) that the browser is allowed to import directly.
import { AttributionCell } from "./types";
import { callModel, ModelCallError } from "./models";
import { getApiKey } from "./apiKeys";
import { buildAttributionPrompt, parseRating } from "./attribution";

/** Executes one cell: builds the prompt, calls the model, parses the rating. */
export async function executeAttributionCell(
  promptTemplate: string,
  cell: AttributionCell
): Promise<AttributionCell> {
  const apiKey = getApiKey(cell.model);

  const filledPrompt = buildAttributionPrompt(promptTemplate, cell.plus50_name, cell.minus50_name);
  // Story sent alongside the filled prompt in one message (§3).
  const combined = `${cell.vignette_text}\n\n${filledPrompt}`;

  try {
    const result = await callModel(cell.model, apiKey, cell.model_snapshot, combined);
    const { rating, parseError } = parseRating(result.text);
    return {
      ...cell,
      status: "done",
      rating,
      raw_response: result.text,
      parse_error: parseError,
      error: null,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof ModelCallError ? err.message : "Unknown error.";
    return {
      ...cell,
      status: "error",
      error: message,
      timestamp: new Date().toISOString(),
    };
  }
}
