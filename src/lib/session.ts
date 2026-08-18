// Signed session cookie helpers. Built on Web Crypto (`crypto.subtle`) rather
// than node:crypto so the exact same code runs in both the Edge middleware
// and Node.js API routes.

const COOKIE_NAME = "pilot_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET env var is not set. Set it to a long random string."
    );
  }
  return secret;
}

function toBase64Url(bytes: Uint8Array): string {
  let base64: string;
  if (typeof Buffer !== "undefined") {
    base64 = Buffer.from(bytes).toString("base64");
  } else {
    base64 = btoa(String.fromCharCode(...bytes));
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function importKey(): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(getSecret());
  return crypto.subtle.importKey(
    "raw",
    enc,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Creates a signed session token: base64url(payload).base64url(signature) */
export async function createSessionToken(): Promise<string> {
  const payload = JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  const payloadBytes = new TextEncoder().encode(payload);
  const key = await importKey();
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Verifies a session token's signature and expiry. */
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadPart, sigPart] = parts;
  try {
    const payloadBytes = fromBase64Url(payloadPart);
    const sigBytes = fromBase64Url(sigPart);
    const key = await importKey();
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes.slice(), payloadBytes.slice());
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      exp: number;
    };
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export { COOKIE_NAME };
