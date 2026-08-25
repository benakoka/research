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
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs / 1000}s.`);
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function isTimeoutError(err: unknown): err is Error {
  return err instanceof Error && err.name === "TimeoutError";
}
