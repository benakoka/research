// Server-only: this pulls in lib/models (fetch calls to provider APIs) and
// lib/apiKeys (reads server env vars for secrets). Only import this from
// API routes, never from a client component — see lib/attribution.ts for
// the pure, client-safe half of this module (building cells, parsing
// ratings) that the browser is allowed to import directly.
import { AttributionCell } from "./types";
import { callModel, ModelCallError } from "./models";
import { getApiKey } from "./apiKeys";
import { buildAttributionPrompt, parseRating, MAX_RATING_PARSE_ATTEMPTS } from "./attribution";

// Appended to the prompt starting on the 2nd attempt only — the 1st attempt
// is always the exact, unmodified prompt (matches the documented
// methodology). A model that ignores "respond with only the number" often
// isn't refusing outright, it's writing out actual deliberation (weighed
// arguments, a concluding sentence) — repeating the identical prompt
// verbatim doesn't push back on that pattern at all, it just asks the same
// question again and tends to get the same kind of verbose answer again.
// This is a direct, escalating nudge specifically calling out the failure,
// which costs nothing on a normal cell (attempt 1 almost always succeeds)
// but gives a stuck cell a real chance to break out of it instead of
// burning all MAX_RATING_PARSE_ATTEMPTS tries on identical requests.
const RETRY_REMINDER =
  "\n\n(Your previous response did not contain a single, unambiguous numeric rating. " +
  "Respond with ONLY the number on the scale above — no words, no explanation, no list of arguments.)";

/**
 * Executes one cell: builds the prompt, calls the model, parses the rating.
 * If the response has no parseable number in it, retries — not a manual
 * click, automatic — up to MAX_RATING_PARSE_ATTEMPTS times, stopping the
 * moment a number comes back, appending RETRY_REMINDER from the 2nd attempt
 * on. Only once every attempt comes back non-numeric does this surface as
 * an error, so a stray non-numeric response no longer needs a manual
 * "Retry" click to clear.
 */
export async function executeAttributionCell(
  promptTemplate: string,
  cell: AttributionCell
): Promise<AttributionCell> {
  const apiKey = getApiKey(cell.model);

  const filledPrompt = buildAttributionPrompt(
    promptTemplate,
    cell.plus50_name,
    cell.minus50_name,
    cell.domain,
    cell.valence
  );
  // Story sent alongside the filled prompt in one message (§3).
  const combined = `${cell.vignette_text}\n\n${filledPrompt}`;

  let lastRawResponse: string | null = null;
  let lastParseError: string | null = null;

  try {
    for (let attempt = 1; attempt <= MAX_RATING_PARSE_ATTEMPTS; attempt++) {
      const prompt = attempt === 1 ? combined : combined + RETRY_REMINDER;
      const result = await callModel(cell.model, apiKey, cell.model_snapshot, prompt);
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
