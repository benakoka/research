import { NextResponse } from "next/server";

/**
 * Wraps an API route handler so an unexpected throw (e.g. Vercel KV not
 * configured yet) comes back as a real JSON { error } message instead of a
 * bare 500 with no body — Next.js doesn't do this by default, and a bare
 * 500 shows up client-side as a generic "X failed" with no way to tell what
 * actually went wrong.
 */
export function withApiErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Internal server error.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
