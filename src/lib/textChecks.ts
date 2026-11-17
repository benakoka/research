/** Case-sensitive substring presence check for a character's name in seed/rewritten text. */
export function containsName(text: string, name: string): boolean {
  return name.length > 0 && text.includes(name);
}

// Lightweight heuristic for a reply that declines to do the rewrite instead
// of attempting it (§4/§5's "declines or apologizes") — not exhaustive, just
// common refusal/apology phrasing a model uses instead of just rewriting the
// story. False negatives fall through to the word-count/name-presence
// checks instead, which is the safer failure mode here: a false positive
// would wrongly discard a compliant rewrite, so this stays a short, literal
// list rather than broad pattern matching.
const REFUSAL_PATTERNS = [
  /\bi('m| am) sorry\b/i,
  /\bi cannot\b/i,
  /\bi can't\b/i,
  /\bi won't\b/i,
  /\bi('m| am) unable to\b/i,
  /\bas an ai\b/i,
  /\bi('m| am) not able to\b/i,
  /\bi must decline\b/i,
  /\bcannot (assist|comply|fulfill)\b/i,
];

export function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((p) => p.test(text));
}
