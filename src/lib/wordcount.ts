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
