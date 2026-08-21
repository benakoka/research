// Server-only: this pulls in lib/models (fetch calls to provider APIs) and
// lib/apiKeys (reads server env vars for secrets). Only import this from
// API routes, never from a client component — see lib/attribution.ts for
// the pure, client-safe half of this module (building cells, parsing
// ratings) that the browser is allowed to import directly.
import { AttributionCell } from "./types";
import { callModel, ModelCallError } from "./models";
import { getApiKey } from "./apiKeys";
import { buildAttributionPrompt, parseRating, MAX_RATING_PARSE_ATTEMPTS } from "./attribution";

/**
 * Executes one cell: builds the prompt, calls the model, parses the rating.
 * If the response has no parseable number in it, retries the exact same
 * call — not a manual click, automatic — up to MAX_RATING_PARSE_ATTEMPTS
 * times, stopping the moment a number comes back. Only once every attempt
 * comes back non-numeric does this surface as an error, so a stray
 * non-numeric response no longer needs a manual "Retry" click to clear.
 */
export async function executeAttributionCell(
  promptTemplate: string,
  cell: AttributionCell
): Promise<AttributionCell> {
  const apiKey = getApiKey(cell.model);

  const filledPrompt = buildAttributionPrompt(promptTemplate, cell.plus50_name, cell.minus50_name);
  // Story sent alongside the filled prompt in one message (§3).
  const combined = `${cell.vignette_text}\n\n${filledPrompt}`;

  let lastRawResponse: string | null = null;
  let lastParseError: string | null = null;

  try {
    for (let attempt = 1; attempt <= MAX_RATING_PARSE_ATTEMPTS; attempt++) {
      const result = await callModel(cell.model, apiKey, cell.model_snapshot, combined);
      const { rating, parseError } = parseRating(result.text);
      if (rating !== null) {
        return {
          ...cell,
          status: "done",
          rating,
          raw_response: result.text,
          parse_error: null,
          error: null,
          timestamp: new Date().toISOString(),
        };
      }
      lastRawResponse = result.text;
      lastParseError = parseError;
    }

    return {
      ...cell,
      status: "error",
      rating: null,
      raw_response: lastRawResponse,
      parse_error: lastParseError,
      error: `No numeric rating found in the response after ${MAX_RATING_PARSE_ATTEMPTS} attempts.`,
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
