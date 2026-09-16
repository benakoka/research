// Shared by all three providers (openai/gemini/anthropic) so a hung request
// can't block an entire batch forever. `Promise.all` in the /process routes
// waits on every call in the batch — without a timeout, one stalled provider
// request would stall up to 10 cells/generations indefinitely. Kept well
// under the process routes' maxDuration despite callModel retrying failed
// calls up to 4x — a single attempt hanging for the old 60s default could
// alone burn through most of that budget.
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Like `fetch`, but aborts after `timeoutMs` and throws a plain Error with a
 * clear message (`err.name === "TimeoutError"`) instead of a raw
 * AbortError/DOMException, so callers can detect it with a simple check.
 *
 * `externalSignal` (optional) is a second, independent reason to abort —
 * plumbed all the way from the browser's Pause button through the /process
 * route's own request signal. Without this, aborting the *client's* fetch
 * to /api/attribution/process had no effect on the actual outbound call
 * this function makes to OpenAI/Gemini: the client stops waiting for a
 * response, but the server keeps making that call (and retrying it, up to
 * MAX_ATTEMPTS/MAX_RATING_PARSE_ATTEMPTS times) completely unaware anyone
 * asked it to stop — burning real provider calls for a cell the client
 * already put back to "pending" and is about to resend. Linking the two
 * signals here means Pause actually kills the in-flight provider request,
 * not just the browser's wait for it.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", forwardAbort);
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (externalSignal?.aborted) {
        const abortErr = new Error("Request cancelled.");
        abortErr.name = "AbortError";
        throw abortErr;
      }
      const timeoutErr = new Error(`Request timed out after ${timeoutMs / 1000}s.`);
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", forwardAbort);
  }
}

export function isTimeoutError(err: unknown): err is Error {
  return err instanceof Error && err.name === "TimeoutError";
}

// Distinguished from isTimeoutError so callModel/executeAttributionCell can
// stop retrying immediately on a deliberate cancellation, rather than
// spending more attempts (with backoff) on a call nobody's waiting on
// anymore.
export function isAbortError(err: unknown): err is Error {
  return err instanceof Error && err.name === "AbortError";
}
