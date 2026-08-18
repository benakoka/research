/** Masks a secret for display — never echo API keys back in full (§2). */
export function maskSecret(secret: string): string | null {
  if (!secret) return null;
  if (secret.length <= 4) return "••••";
  return `••••${secret.slice(-4)}`;
}
