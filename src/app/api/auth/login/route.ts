import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/password";
import { createSessionToken, COOKIE_NAME } from "@/lib/session";
import { withApiErrorHandling } from "@/lib/apiError";

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const storedHash = process.env.PASSWORD_HASH;
  if (!storedHash) {
    return NextResponse.json(
      { error: "Server is missing PASSWORD_HASH env var." },
      { status: 500 }
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

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
});
