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
  UsageCounters,
  EMPTY_USAGE,
  ModelProvider,
} from "./types";

const KEYS = {
  settings: "pilot:settings",
  vignetteSet: "pilot:vignetteSet",
  attributionRun: "pilot:attributionRun",
  rewritingRun: "pilot:rewritingRun",
  usage: "pilot:usage",
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

function write<T>(key: string, value: T): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Most likely quota exceeded (a long run's raw responses can add up).
    console.error(`Failed to persist ${key} to localStorage`, err);
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

export function saveAttributionRun(run: AttributionRun): void {
  write(KEYS.attributionRun, run);
}

export function clearAttributionRun(): void {
  clear(KEYS.attributionRun);
}

export function getRewritingRun(): RewritingRun | null {
  return read<RewritingRun | null>(KEYS.rewritingRun, null);
}

export function saveRewritingRun(run: RewritingRun): void {
  write(KEYS.rewritingRun, run);
}

export function clearRewritingRun(): void {
  clear(KEYS.rewritingRun);
}

// ---------------------------------------------------------------------------
// Usage / cost visibility (§5) — accumulated client-side across every batch
// response this browser has seen, since there's no server to total it.
// ---------------------------------------------------------------------------

export function getUsage(): UsageCounters {
  return read<UsageCounters>(KEYS.usage, EMPTY_USAGE);
}

export function addUsage(delta: Partial<Record<ModelProvider, { calls: number; inputTokens: number; outputTokens: number }>>): UsageCounters {
  const current = getUsage();
  for (const model of Object.keys(delta) as ModelProvider[]) {
    const d = delta[model];
    if (!d) continue;
    current.calls[model] = (current.calls[model] ?? 0) + d.calls;
    current.inputTokens[model] = (current.inputTokens[model] ?? 0) + d.inputTokens;
    current.outputTokens[model] = (current.outputTokens[model] ?? 0) + d.outputTokens;
  }
  write(KEYS.usage, current);
  return current;
}
