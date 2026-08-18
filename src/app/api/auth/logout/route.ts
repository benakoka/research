import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/session";
import { withApiErrorHandling } from "@/lib/apiError";

export const POST = withApiErrorHandling(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
});
