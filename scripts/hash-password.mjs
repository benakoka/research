#!/usr/bin/env node
// Generates the PASSWORD_HASH value for the shared site password gate.
// Usage: node scripts/hash-password.mjs "your password here"
// Paste the printed value into the PASSWORD_HASH env var (Vercel project
// settings, or .env.local for dev). The plaintext password itself is never
// stored anywhere.

import { scryptSync, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "your password here"');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log(`${salt.toString("hex")}:${hash.toString("hex")}`);
