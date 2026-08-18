import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

// Single shared password gate in front of the entire app (§1). Everything
// except the login page/API and a few public static assets requires a valid
// signed session cookie.
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/robots.txt",
  "/favicon.ico",
]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const valid = await verifySessionToken(token);

  if (valid) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match everything except:
     * - static assets under /_next
     * - the favicon
     */
    "/((?!_next/static|_next/image).*)",
  ],
};
