import { kvGet, kvSet, kvIndexAdd, kvIndexList } from "./kv";
import {
  Settings,
  DEFAULT_SETTINGS,
  VignetteSet,
  AttributionRun,
  AttributionCell,
  RewritingRun,
  RewritingChain,
  UsageCounters,
  EMPTY_USAGE,
  ModelProvider,
} from "./types";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "settings";

export async function getSettings(): Promise<Settings> {
  const stored = await kvGet<Settings>(SETTINGS_KEY);
  if (!stored) return DEFAULT_SETTINGS;
  // Merge so newly-added fields fall back to defaults for older stored settings.
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await kvSet(SETTINGS_KEY, next);
  return next;
}

// ---------------------------------------------------------------------------
// Vignette sets
// ---------------------------------------------------------------------------

const VIGNETTE_INDEX = "index:vignettesets";
const vignetteKey = (id: string) => `vignetteset:${id}`;

export async function saveVignetteSet(set: VignetteSet): Promise<void> {
  await kvSet(vignetteKey(set.id), set);
  await kvIndexAdd(VIGNETTE_INDEX, set.id);
}

export async function getVignetteSet(id: string): Promise<VignetteSet | null> {
  return kvGet<VignetteSet>(vignetteKey(id));
}

export async function listVignetteSets(): Promise<VignetteSet[]> {
  const ids = await kvIndexList(VIGNETTE_INDEX);
  const sets = await Promise.all(ids.map((id) => getVignetteSet(id)));
  return sets.filter((s): s is VignetteSet => s !== null);
}

// ---------------------------------------------------------------------------
// Attribution runs & cells
// ---------------------------------------------------------------------------

const ATTR_RUN_INDEX = "index:attrruns";
const attrRunKey = (id: string) => `attrrun:${id}`;
const attrCellKey = (runId: string, cellId: string) => `attrcell:${runId}:${cellId}`;

export async function saveAttributionRun(run: AttributionRun): Promise<void> {
  await kvSet(attrRunKey(run.id), run);
  await kvIndexAdd(ATTR_RUN_INDEX, run.id);
}

export async function getAttributionRun(id: string): Promise<AttributionRun | null> {
  return kvGet<AttributionRun>(attrRunKey(id));
}

export async function listAttributionRuns(): Promise<AttributionRun[]> {
  const ids = await kvIndexList(ATTR_RUN_INDEX);
  const runs = await Promise.all(ids.map((id) => getAttributionRun(id)));
  return runs.filter((r): r is AttributionRun => r !== null);
}

export async function saveAttributionCell(
  runId: string,
  cell: AttributionCell
): Promise<void> {
  await kvSet(attrCellKey(runId, cell.id), cell);
}

export async function getAttributionCell(
  runId: string,
  cellId: string
): Promise<AttributionCell | null> {
  return kvGet<AttributionCell>(attrCellKey(runId, cellId));
}

export async function getAttributionCells(run: AttributionRun): Promise<AttributionCell[]> {
  const cells = await Promise.all(
    run.cellIds.map((cellId) => getAttributionCell(run.id, cellId))
  );
  return cells.filter((c): c is AttributionCell => c !== null);
}

// ---------------------------------------------------------------------------
// Rewriting runs & chains
// ---------------------------------------------------------------------------

const RW_RUN_INDEX = "index:rwruns";
const rwRunKey = (id: string) => `rwrun:${id}`;
const rwChainKey = (runId: string, chainId: string) => `rwchain:${runId}:${chainId}`;

export async function saveRewritingRun(run: RewritingRun): Promise<void> {
  await kvSet(rwRunKey(run.id), run);
  await kvIndexAdd(RW_RUN_INDEX, run.id);
}

export async function getRewritingRun(id: string): Promise<RewritingRun | null> {
  return kvGet<RewritingRun>(rwRunKey(id));
}

export async function listRewritingRuns(): Promise<RewritingRun[]> {
  const ids = await kvIndexList(RW_RUN_INDEX);
  const runs = await Promise.all(ids.map((id) => getRewritingRun(id)));
  return runs.filter((r): r is RewritingRun => r !== null);
}

export async function saveRewritingChain(
  runId: string,
  chain: RewritingChain
): Promise<void> {
  await kvSet(rwChainKey(runId, chain.id), chain);
}

export async function getRewritingChain(
  runId: string,
  chainId: string
): Promise<RewritingChain | null> {
  return kvGet<RewritingChain>(rwChainKey(runId, chainId));
}

export async function getRewritingChains(run: RewritingRun): Promise<RewritingChain[]> {
  const chains = await Promise.all(
    run.chainIds.map((chainId) => getRewritingChain(run.id, chainId))
  );
  return chains.filter((c): c is RewritingChain => c !== null);
}

// ---------------------------------------------------------------------------
// Usage / cost visibility (§5)
// ---------------------------------------------------------------------------

const USAGE_KEY = "usage";

export async function getUsage(): Promise<UsageCounters> {
  const stored = await kvGet<UsageCounters>(USAGE_KEY);
  return stored ?? EMPTY_USAGE;
}

export async function recordUsage(
  model: ModelProvider,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const current = await getUsage();
  current.calls[model] = (current.calls[model] ?? 0) + 1;
  current.inputTokens[model] = (current.inputTokens[model] ?? 0) + inputTokens;
  current.outputTokens[model] = (current.outputTokens[model] ?? 0) + outputTokens;
  await kvSet(USAGE_KEY, current);
}
