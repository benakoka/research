import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/password";
import { createSessionToken, COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/session";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, resetRateLimit } from "@/lib/rateLimit";

/** Best-effort client identifier for rate limiting — see lib/rateLimit.ts.
 * `x-forwarded-for` is what Vercel sets to the real client IP; falls back to
 * a single shared bucket for local dev, where there's no proxy setting it
 * and no real brute-force threat to mitigate. */
function clientKey(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const storedHash = process.env.PASSWORD_HASH;
  if (!storedHash) {
    return NextResponse.json(
      { error: "Server is missing PASSWORD_HASH env var." },
      { status: 500 }
    );
  }

  const key = clientKey(req);
  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let password: string;
  try {
    const body = await req.json();
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!password || !verifyPassword(password, storedHash)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  // A correct password shouldn't leave a few earlier typos counting against
  // the next attempt from this key (e.g. a shared office IP).
  resetRateLimit(key);

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Was hardcoded separately from the token's own embedded expiry (§ see
    // lib/session.ts) — kept in sync now so the cookie doesn't outlive the
    // token it holds (or vice versa).
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
});
