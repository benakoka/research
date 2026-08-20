"use client";

// Everything the app needs to remember lives in the browser's localStorage —
// there is deliberately no server-side database. Settings, the uploaded
// vignette set, and in-progress runs all live here; the server API routes
// are stateless transforms (parse this file, run this batch, export this
// data) that never write anything down. Closing the browser tab loses
// nothing that isn't also written here first; clearing browser data does
// lose it, same as any localStorage-backed app.

import {
  Settings,
  DEFAULT_SETTINGS,
  VignetteSet,
  AttributionRun,
  RewritingRun,
} from "./types";

const KEYS = {
  settings: "pilot:settings",
  vignetteSet: "pilot:vignetteSet",
  attributionRun: "pilot:attributionRun",
  rewritingRun: "pilot:rewritingRun",
} as const;

function isBrowser() {
  return typeof window !== "undefined";
}

function read<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Returns whether the write actually succeeded — callers that depend on
 * this persisting (an in-progress run, in particular) need to know, since a
 * silently swallowed quota-exceeded error would otherwise mean "closing the
 * tab loses nothing" quietly stops being true with no indication to the
 * user. See saveAttributionRun/saveRewritingRun and their callers. */
function write<T>(key: string, value: T): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // Most likely quota exceeded (a long run's raw responses can add up).
    console.error(`Failed to persist ${key} to localStorage`, err);
    return false;
  }
}

function clear(key: string): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(key);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  return next;
}

// ---------------------------------------------------------------------------
// Vignette set (one active set at a time)
// ---------------------------------------------------------------------------

export function getVignetteSet(): VignetteSet | null {
  return read<VignetteSet | null>(KEYS.vignetteSet, null);
}

export function saveVignetteSet(set: VignetteSet): void {
  write(KEYS.vignetteSet, set);
}

// ---------------------------------------------------------------------------
// Attribution / Rewriting runs (one active run at a time, per module)
// ---------------------------------------------------------------------------

export function getAttributionRun(): AttributionRun | null {
  return read<AttributionRun | null>(KEYS.attributionRun, null);
}

/** Returns false if the write failed (e.g. localStorage quota exceeded) —
 * the run continues in memory either way, but the caller should warn the
 * user that new results have stopped actually being saved. */
export function saveAttributionRun(run: AttributionRun): boolean {
  return write(KEYS.attributionRun, run);
}

export function clearAttributionRun(): void {
  clear(KEYS.attributionRun);
}

export function getRewritingRun(): RewritingRun | null {
  return read<RewritingRun | null>(KEYS.rewritingRun, null);
}

/** Returns false if the write failed (e.g. localStorage quota exceeded) —
 * the run continues in memory either way, but the caller should warn the
 * user that new results have stopped actually being saved. */
export function saveRewritingRun(run: RewritingRun): boolean {
  return write(KEYS.rewritingRun, run);
}

export function clearRewritingRun(): void {
  clear(KEYS.rewritingRun);
}
