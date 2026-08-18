import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// Node-only (scrypt isn't in Web Crypto), so only import this from Node.js
// runtime code — the login API route, and the one-off hashing script.
// `PASSWORD_HASH` env var format: "<saltHex>:<hashHex>", produced by
// scripts/hash-password.mjs.

export function hashPassword(password: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, 64);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
