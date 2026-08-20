/** Simple whitespace word count, used for rewriting compliance tracking (§4). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** True if `actual` misses `target` by more than `thresholdFraction` (e.g. 0.25 = 25%). */
export function missesTarget(
  actual: number,
  target: number,
  thresholdFraction: number
): boolean {
  if (target <= 0) return false;
  return Math.abs(actual - target) / target > thresholdFraction;
}

/**
 * Confirmed protocol (§4): a generation retries — re-reading the same source
 * text it started from, not its own failed output — until it complies, with
 * a safety cap so a target/threshold combination a model can never hit
 * doesn't retry forever. Hitting the cap without complying is a hard error
 * for that generation (blocks the rest of its chain), not a silent accept.
 */
export const MAX_REWRITE_ATTEMPTS = 10;
