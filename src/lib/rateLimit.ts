// Best-effort, in-memory rate limiter for the login endpoint. There's no
// server-side database in this app by design (see README "Where data
// lives"), so this can't be a fully distributed limiter — each serverless
// instance has its own memory, and it resets on a cold start. It still
// meaningfully raises the cost of scripted brute-forcing the one shared
// password from any single warm instance, which is the realistic threat
// here: this password gates real OpenAI/Gemini spending, not just data.
//
// Deliberately simple (a Map, no external service) to match the rest of the
// app's no-paid-infra constraint — see lib/apiKeys.ts / lib/session.ts for
// the same reasoning applied elsewhere.

interface Bucket {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

// Bound memory growth from many distinct keys (IPs) hitting the endpoint —
// prune stale entries once the map gets large rather than growing forever.
const MAX_TRACKED_KEYS = 5000;

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets, only meaningful when allowed is false. */
  retryAfterSeconds: number;
}

/** Call once per login attempt (success or failure) before checking the
 * password. Returns whether this attempt is allowed to proceed. */
export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    pruneIfNeeded(now);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  bucket.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Call on a successful login so a few earlier typos don't count against
 * the next person to use this key (e.g. same shared office IP). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

function pruneIfNeeded(now: number) {
  if (buckets.size <= MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) buckets.delete(key);
  }
}
