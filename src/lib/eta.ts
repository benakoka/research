// Shared "estimated time remaining" logic for the Attribution and Rewriting
// pages. Both drive a run as a sequence of batches (see each page's
// driveRun), so the only ground truth we have for how fast this specific
// run is actually going is: how many items got marked done/error, and how
// much wall-clock time that took. Everything here is built from that —
// no fixed per-item guess, since actual throughput depends on batch size,
// provider latency (which can shift mid-run — see e.g. Gemini demand
// spikes), and how many cells in a batch needed a retry.
export interface EtaSample {
  t: number; // ms epoch when this sample was taken
  n: number; // cumulative completed (done+error) count at that time
}

// How far back we look for the throughput used in the estimate. Long enough
// to smooth over one-off blips (a single slow retry in one batch), short
// enough to react within roughly a minute if the run's overall pace shifts
// (e.g. a provider getting slower/faster under demand) instead of dragging
// in throughput from an earlier, unrepresentative phase of a long run.
const WINDOW_MS = 90_000;
// Even within the window, don't trust a span shorter than this — right
// after a run starts (or after a burst of fast batches), the gap between
// the oldest and newest sample can be a couple seconds, which makes the
// rate wildly noisy. When the window doesn't yet cover this much wall time,
// fall back to the run's full history instead — the best available
// estimate before there's enough recent data to detect a pace change.
const MIN_SPAN_MS = 10_000;
// Bounds memory on a very long run (thousands of batches) — far more than
// WINDOW_MS/typical batch cadence would ever need, so it never affects the
// estimate in practice.
export const MAX_ETA_SAMPLES = 300;

export function pushEtaSample(samples: EtaSample[], sample: EtaSample): EtaSample[] {
  return [...samples, sample].slice(-MAX_ETA_SAMPLES);
}

/** Seconds remaining, or null if there isn't yet enough data to estimate. */
export function estimateEtaSeconds(samples: EtaSample[], remaining: number): number | null {
  if (remaining <= 0 || samples.length < 2) return null;
  const newest = samples[samples.length - 1];

  const windowed = samples.filter((s) => newest.t - s.t <= WINDOW_MS);
  const usable = windowed.length >= 2 && newest.t - windowed[0].t >= MIN_SPAN_MS ? windowed : samples;

  const oldest = usable[0];
  const itemsDelta = newest.n - oldest.n;
  const secondsDelta = (newest.t - oldest.t) / 1000;
  if (itemsDelta <= 0 || secondsDelta <= 0) return null;

  const rate = itemsDelta / secondsDelta; // items per second, over the chosen window
  return remaining / rate;
}

/** "45s", "3m 20s", "1h 5m" — always rounded to something readable, never to the second past a minute. */
export function formatEta(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}
