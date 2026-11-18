"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import VignetteUploader from "../VignetteUploader";
import { buildRewritingChains, nextRunnableGenerationIndex, pendingGeneration } from "@/lib/rewriting";
import {
  getSettings,
  getRewritingRun,
  saveRewritingRun,
  clearRewritingRun,
  estimateLocalStorageUsageFraction,
} from "@/lib/clientStorage";
import { RewritingChain, RewritingRun, VignetteSet } from "@/lib/types";
import { EtaSample, estimateEtaSeconds, formatEta, pushEtaSample } from "@/lib/eta";
import { buildRewritingAttemptLogCsv } from "@/lib/export/rewritingAttemptLog";

// Kept small deliberately: Promise.all in the /process route waits for the
// slowest generation in a batch, so a larger batch means more concurrent
// generations sharing the risk of one being slow under real provider demand
// (e.g. Gemini taking close to its 45s timeout) — a smaller batch surfaces
// progress more often and bounds how much a single slow generation can hold
// up.
const BATCH_SIZE = 4;
// How many /process requests driveRun keeps in flight at once (see the
// worker-pool loop below). This is the main lever for total run time: each
// request is still only ever BATCH_SIZE generations (so one slow one still
// only risks holding up BATCH_SIZE-1 others, same as before), but
// WORKER_COUNT such requests now run concurrently instead of one at a
// time — a large run's wall-clock time is dominated by how many calls have
// to happen serially, not by any single call's latency. 3 was picked as a
// first step: meaningfully faster without pushing so much simultaneous load
// at GPT/Gemini that rate limits (429s) start showing up instead. Raise it
// if a real run comes back clean with no new rate-limit errors; lower it if
// one does.
const WORKER_COUNT = 3;

type ExportFormat = "long" | "wide" | "vignettes" | "attempt_log";

const EXPORT_FILENAMES: Record<ExportFormat, string> = {
  long: "rewriting_successful_outputs.csv",
  wide: "rewriting_wide.xlsx",
  vignettes: "rewriting_as_vignettes.xlsx",
  attempt_log: "rewriting_attempt_log.csv",
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// attemptLog is by far the biggest thing a chain carries — every attempt's
// full raw provider response, growing with every retry a run ever made —
// and only the "attempt_log" export format actually needs it server-side.
// Sending it along with every other export format risked a real run's
// request body blowing past the platform's request-size limit for no
// reason, which is exactly what silently broke every export button on a
// large run, not just that one. Stripped here rather than in the API
// route so the oversized payload is never sent at all.
function withoutAttemptLog(chains: RewritingChain[]): RewritingChain[] {
  return chains.map((c) => ({ ...c, attemptLog: [] }));
}

async function fetchExport(chains: RewritingChain[], format: ExportFormat): Promise<Blob> {
  const res = await fetch("/api/rewriting/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chains: withoutAttemptLog(chains), format }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Export failed.");
  }
  return res.blob();
}

function overallStats(chains: RewritingChain[]) {
  const statuses = chains.flatMap((c) => c.generations.slice(1).map((g) => g.status));
  const total = statuses.length;
  const done = statuses.filter((s) => s === "done").length;
  const error = statuses.filter((s) => s === "error").length;
  const running = statuses.filter((s) => s === "running").length;
  const pending = statuses.filter((s) => s === "pending").length;
  return { total, done, error, running, pending };
}

function dryRunSixIds(rows: VignetteSet["rows"]): Set<string> {
  const seenCombo = new Set<string>();
  const ids = new Set<string>();
  for (const row of rows) {
    const key = `${row.domain}::${row.valence}`;
    if (!seenCombo.has(key)) {
      seenCombo.add(key);
      ids.add(row.vignette_id);
    }
  }
  return ids;
}

export default function RewritingPage() {
  const [vignetteSet, setVignetteSet] = useState<VignetteSet | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowsExpanded, setRowsExpanded] = useState(false);
  const [run, setRun] = useState<RewritingRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error` (which is transient, about the last batch/export
  // action) — this one persists across renders once set, because it means
  // this browser has silently stopped being able to save the run at all
  // (most likely localStorage quota exceeded), or is close to that point.
  // The run keeps going in memory either way, but "closing the tab loses
  // nothing" is no longer true once this is set, so it needs to stay
  // visible until the user exports (or dismisses it deliberately), not
  // just flash by.
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const runningRef = useRef(false);
  // Checked at the top of every worker loop iteration (between batches) so
  // Pause takes effect even if a batch happens to already be in flight when
  // it's clicked. abortControllersRef additionally kills every batch
  // request actually in flight right now (which the server forwards into
  // the actual provider call — see /api/rewriting/process's req.signal),
  // so Pause doesn't have to wait out a slow/retrying batch before doing
  // anything, and doesn't leave orphaned provider calls running unseen in
  // the background for generations the client has already put back to
  // "pending".
  const pauseRequestedRef = useRef(false);
  // A Set instead of a single ref now that multiple batch requests can be
  // in flight at once (see WORKER_COUNT) — Pause needs to abort all of
  // them, not just the most recent one.
  const abortControllersRef = useRef<Set<AbortController>>(new Set());
  // Throughput history for the "estimated time remaining" display — see
  // lib/eta.ts. Reset at the start of every driveRun call (fresh run,
  // resume, or a single-generation retry cascade) so a slow/fast earlier
  // session never pollutes a new one.
  const etaSamplesRef = useRef<EtaSample[]>([]);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  function completedCount(chains: RewritingChain[]) {
    const stats = overallStats(chains);
    return stats.done + stats.error;
  }

  function persist(updated: RewritingRun) {
    setRun(updated);
    const ok = saveRewritingRun(updated);
    if (!ok) {
      setStorageWarning(
        "This browser's storage is full, so new results are no longer being saved — they only exist in this tab until you export. Export now, or free up space (clear old runs/other sites' data) and reload to resume normal saving."
      );
      return;
    }
    // Proactive — fires *before* an actual write failure, unlike the branch
    // above. estimateLocalStorageUsageFraction is a heuristic (localStorage
    // quotas vary by browser and aren't queryable directly), so this errs
    // toward warning early rather than precisely.
    const frac = estimateLocalStorageUsageFraction();
    if (frac >= 0.8) {
      setStorageWarning(
        `This browser's local storage is at roughly ${Math.round(frac * 100)}% of an assumed ~5MB per-origin limit — export soon, or it may silently stop saving new results.`
      );
    }
  }

  async function downloadExport(chains: RewritingChain[], format: ExportFormat) {
    // Built directly in the browser, not round-tripped through the API —
    // this is precisely the export carrying the data too big to safely
    // send over the wire (see withoutAttemptLog's comment above). It's a
    // pure string builder (lib/export/rewritingAttemptLogCsv.ts) with no
    // server secrets, so there's nothing it needs the server for.
    if (format === "attempt_log") {
      const csv = buildRewritingAttemptLogCsv(chains);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), EXPORT_FILENAMES[format]);
      return;
    }
    const blob = await fetchExport(chains, format);
    downloadBlob(blob, EXPORT_FILENAMES[format]);
  }

  async function exportRun(format: ExportFormat) {
    if (!run) return;
    setExporting(format);
    setError(null);
    try {
      await downloadExport(run.chains, format);
      // A successful export is a durable copy outside this browser's
      // storage, so whatever the local-save situation is no longer matters
      // for anything already in the file.
      setStorageWarning(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }

  async function processBatch(
    chains: RewritingChain[],
    promptTemplate: string,
    retryThresholdFraction: number,
    retryThresholdEnabled: boolean,
    apiErrorRetryLimit: number,
    refusalEmptyRetryLimit: number,
    signal?: AbortSignal
  ) {
    const res = await fetch("/api/rewriting/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chains,
        promptTemplate,
        retryThresholdFraction,
        retryThresholdEnabled,
        apiErrorRetryLimit,
        refusalEmptyRetryLimit,
      }),
      signal,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Batch failed.");
    return body.chains as RewritingChain[];
  }

  async function driveRun(current: RewritingRun) {
    if (runningRef.current) return;
    runningRef.current = true;
    setProcessing(true);
    setError(null);
    pauseRequestedRef.current = false;
    const settings = getSettings();
    // Seed with "now, at whatever's already done" — matters for a resumed
    // run (page refresh mid-run) and for a retry cascade kicked off from an
    // otherwise-finished run, where generations completed before this call
    // shouldn't count toward this call's measured rate.
    etaSamplesRef.current = [{ t: Date.now(), n: completedCount(current.chains) }];
    setEtaSeconds(null);

    // `working` is shared, mutable state read and written by every worker
    // below. That's safe without a real lock only because every read-claim-
    // write sequence here runs synchronously, with no `await` in between —
    // JS never interleaves two synchronous stretches of code, so two
    // workers can never both claim the same chain's runnable generation
    // (marking it "running" makes nextRunnableGenerationIndex return null
    // for that chain until it resolves). Everything after the `await
    // processBatch(...)` line re-reads `working` fresh (it may have been
    // updated by another worker while this one was in flight) and merges
    // this worker's results on top of that latest state, so no worker's
    // update is ever lost.
    let working = current;
    let fatalError: unknown = null;

    async function worker() {
      while (true) {
        if (pauseRequestedRef.current || fatalError) return;
        const claim = working.chains
          .map((chain) => ({ chain, genIndex: nextRunnableGenerationIndex(chain) }))
          .filter((x): x is { chain: RewritingChain; genIndex: number } => x.genIndex !== null)
          .slice(0, BATCH_SIZE);
        if (claim.length === 0) return;

        const genIndexByChainId = new Map(claim.map((x) => [x.chain.id, x.genIndex]));
        working = {
          ...working,
          chains: working.chains.map((c) => {
            const genIndex = genIndexByChainId.get(c.id);
            if (genIndex === undefined) return c;
            const generations = [...c.generations];
            generations[genIndex] = { ...generations[genIndex], status: "running" };
            return { ...c, generations };
          }),
        };

        const controller = new AbortController();
        abortControllersRef.current.add(controller);
        let results: RewritingChain[];
        try {
          results = await processBatch(
            claim.map((x) => x.chain),
            working.promptTemplate,
            working.retryThresholdFraction,
            working.retryThresholdEnabled,
            settings.apiErrorRetryLimit,
            settings.refusalEmptyRetryLimit,
            controller.signal
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          // A genuine failure (not a user-requested pause) should stop the
          // whole run, not just this worker — record it and tell the other
          // workers to wind down too, same as a pause would.
          fatalError = err;
          pauseRequestedRef.current = true;
          for (const c of abortControllersRef.current) c.abort();
          return;
        } finally {
          abortControllersRef.current.delete(controller);
        }

        const byId = new Map(results.map((c) => [c.id, c]));
        working = { ...working, status: "running", chains: working.chains.map((c) => byId.get(c.id) ?? c) };
        persist(working);

        const stats = overallStats(working.chains);
        etaSamplesRef.current = pushEtaSample(etaSamplesRef.current, { t: Date.now(), n: stats.done + stats.error });
        setEtaSeconds(estimateEtaSeconds(etaSamplesRef.current, stats.pending + stats.running));
      }
    }

    try {
      await Promise.all(Array.from({ length: WORKER_COUNT }, () => worker()));
      if (pauseRequestedRef.current && !fatalError) {
        // Any generation a worker claimed (marked "running") but never got
        // a response for — because its request was aborted mid-flight —
        // needs to go back to "pending", the same convention used on
        // resume, otherwise it'd block its chain forever and be missing
        // from both the pending and completed counts.
        const chains = working.chains.map((c) => ({
          ...c,
          generations: c.generations.map((g) => (g.status === "running" ? { ...g, status: "pending" as const } : g)),
        }));
        persist({ ...working, chains, status: "paused" });
        return;
      }
      if (fatalError) throw fatalError;
      persist({ ...working, status: "done" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch failed.");
    } finally {
      runningRef.current = false;
      setProcessing(false);
      setEtaSeconds(null);
    }
  }

  function pauseRun() {
    pauseRequestedRef.current = true;
    for (const c of abortControllersRef.current) c.abort();
  }

  function resumeRun() {
    if (!run || runningRef.current) return;
    const chains = run.chains.map((c) => ({
      ...c,
      generations: c.generations.map((g) => (g.status === "running" ? { ...g, status: "pending" as const } : g)),
    }));
    driveRun({ ...run, chains });
  }

  useEffect(() => {
    (async () => {
      const stored = getRewritingRun();
      setRun(stored);
      // Resume automatically if the page was refreshed mid-run — but not a
      // run the user deliberately paused.
      if (stored && stored.status !== "paused") {
        // Any generation left "running" from a torn-down tab needs to go
        // back to pending before we can pick it up again.
        const chains = stored.chains.map((c) => ({
          ...c,
          generations: c.generations.map((g) => (g.status === "running" ? { ...g, status: "pending" as const } : g)),
        }));
        const resumed = { ...stored, chains };
        if (chains.some((c) => nextRunnableGenerationIndex(c) !== null)) {
          driveRun(resumed);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fresh upload selects every row by default — §8's row-selection is an
  // opt-out narrowing (e.g. down to a 6-row dry run), not an opt-in. Set
  // directly from the uploader's onChange (not a useEffect on vignetteSet)
  // so this doesn't fire as a second, cascading render after the upload.
  function handleVignetteSetChange(next: VignetteSet | null) {
    setVignetteSet(next);
    setSelectedIds(new Set(next ? next.rows.map((r) => r.vignette_id) : []));
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function startRun() {
    if (!vignetteSet) return;
    const rowsToRun = vignetteSet.rows.filter((r) => selectedIds.has(r.vignette_id));
    if (rowsToRun.length === 0) {
      setError("Select at least one vignette row to run (see \"Which seed versions to run\" above).");
      return;
    }
    if (run && overallStats(run.chains).pending + overallStats(run.chains).running > 0) {
      if (!confirm("There's an unfinished run. Starting a new one replaces it. Continue?")) return;
    }
    setStarting(true);
    setError(null);
    try {
      const settings = getSettings();
      if (!settings.enabledModels.GPT && !settings.enabledModels.Gemini) {
        setError("Both GPT and Gemini are turned off in Settings — enable at least one before starting a run.");
        return;
      }
      const chains = buildRewritingChains(
        rowsToRun,
        settings.defaultWordCountTargets,
        settings.gptModelSnapshot,
        settings.geminiModelSnapshot,
        settings.enabledModels
      );
      const newRun: RewritingRun = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        promptTemplate: settings.rewritingPromptTemplate,
        gptModelSnapshot: settings.gptModelSnapshot,
        geminiModelSnapshot: settings.geminiModelSnapshot,
        retryThresholdFraction: settings.retryThresholdFraction,
        retryThresholdEnabled: settings.retryThresholdEnabled,
        vignetteSetFilename: vignetteSet.filename,
        selectedVignetteIds: rowsToRun.map((r) => r.vignette_id),
        chains,
        status: "pending",
      };
      persist(newRun);
      driveRun(newRun);
    } finally {
      setStarting(false);
    }
  }

  async function retryGeneration(chainId: string, gen: number) {
    if (!run) return;
    const key = `${chainId}:${gen}`;
    setRetrying(key);
    setError(null);
    try {
      const chain = run.chains.find((c) => c.id === chainId);
      if (!chain) return;
      const generations = [...chain.generations];
      generations[gen] = { ...generations[gen], status: "pending", error: null };
      // Every generation *after* the one being retried was built from its
      // output text (see lib/rewritingExec.ts — each prompt is the previous
      // generation's text). Once gen's text is about to change, anything
      // downstream is stale and needs to be regenerated too, or the export
      // would silently mix a new Gen2 with a Gen3-5 that were never rebuilt
      // from it.
      for (let i = gen + 1; i <= 5; i++) {
        generations[i] = pendingGeneration(i, chain.wordCountTargets[i - 1]);
      }
      // failedAtGeneration is cleared optimistically — executeGeneration
      // (via the /process route) sets it right back if this retry fails
      // again too.
      const resetChain = { ...chain, generations, failedAtGeneration: null };
      const chains = run.chains.map((c) => (c.id === chainId ? resetChain : c));
      const resetRun = { ...run, chains, status: "running" as const };
      persist(resetRun);
      // Hand off to the normal batch driver so the retried generation *and*
      // the now-invalidated downstream ones all get regenerated in order,
      // instead of leaving them stuck on "pending" until something else
      // happens to restart the run.
      await driveRun(resetRun);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetrying(null);
    }
  }

  // One click to recover from something like running out of API credit
  // mid-run: every chain that failed (exhausted a retry budget — see
  // lib/rewritingExec.ts §5) gets its failed generation, and everything
  // after it, reset to pending, exactly like a single retryGeneration call,
  // then the whole batch is handed back to driveRun. No need to restart
  // the run from scratch — everything already completed stays as-is.
  async function retryAllErrors() {
    if (!run || runningRef.current) return;
    setError(null);
    const chains = run.chains.map((chain) => {
      if (chain.failedAtGeneration === null) return chain;
      const gen = chain.failedAtGeneration;
      const generations = [...chain.generations];
      generations[gen] = { ...generations[gen], status: "pending", error: null };
      for (let i = gen + 1; i <= 5; i++) {
        generations[i] = pendingGeneration(i, chain.wordCountTargets[i - 1]);
      }
      return { ...chain, generations, failedAtGeneration: null };
    });
    const resetRun = { ...run, chains, status: "running" as const };
    persist(resetRun);
    await driveRun(resetRun);
  }

  function startOver() {
    if (!confirm("Discard the current run? This can't be undone unless you've already exported it.")) return;
    clearRewritingRun();
    setRun(null);
  }

  const progress = run ? overallStats(run.chains) : null;
  const pct = progress && progress.total > 0 ? Math.round(((progress.done + progress.error) / progress.total) * 100) : 0;
  const failedChains = run ? run.chains.filter((c) => c.failedAtGeneration !== null) : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Rewriting module</h1>
        <p className="mt-1 text-sm text-slate-600">
          Each selected row × enabled model = an independent 5-generation transmission
          chain. Word-count targets, retry threshold, and retry budgets come from Settings.
          Nothing is saved on a server — this run lives in your browser until you
          export it using the buttons below.
        </p>
      </div>

      {storageWarning && (
        <div
          role="alert"
          className="flex items-start justify-between gap-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          <span>⚠ {storageWarning}</span>
          <button
            onClick={() => setStorageWarning(null)}
            className="shrink-0 text-red-700 underline hover:text-red-900"
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-semibold text-slate-900">Vignette set</h2>
        <VignetteUploader value={vignetteSet} onChange={handleVignetteSetChange} />

        {vignetteSet && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-700">
                Which seed versions to run: {selectedIds.size} of {vignetteSet.rows.length} selected
                {" "}(→ {selectedIds.size * (Object.values(getSettings().enabledModels).filter(Boolean).length || 1)} chains)
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                <button
                  onClick={() => setSelectedIds(dryRunSixIds(vignetteSet.rows))}
                  className="text-slate-700 underline hover:text-slate-900"
                >
                  Dry run: one per domain × valence
                </button>
                <button
                  onClick={() => setSelectedIds(new Set(vignetteSet.rows.map((r) => r.vignette_id)))}
                  className="text-slate-700 underline hover:text-slate-900"
                >
                  Select all
                </button>
                <button onClick={() => setSelectedIds(new Set())} className="text-slate-700 underline hover:text-slate-900">
                  Select none
                </button>
                <button
                  onClick={() => setRowsExpanded((v) => !v)}
                  className="text-slate-700 underline hover:text-slate-900"
                >
                  {rowsExpanded ? "Hide rows" : "Show rows"}
                </button>
              </div>
            </div>
            {rowsExpanded && (
              <div className="mt-3 max-h-80 overflow-auto rounded-md border border-slate-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100">
                    <tr>
                      {["", "vignette_id", "base_vignette_id", "domain", "valence", "name_race", "order_variant"].map(
                        (h) => (
                          <th key={h} className="px-2 py-1 font-medium text-slate-600">
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {vignetteSet.rows.map((row) => (
                      <tr key={row.vignette_id} className="border-t border-slate-100">
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.vignette_id)}
                            onChange={() => toggleRow(row.vignette_id)}
                          />
                        </td>
                        <td className="px-2 py-1 font-mono">{row.vignette_id}</td>
                        <td className="px-2 py-1 font-mono">{row.base_vignette_id}</td>
                        <td className="px-2 py-1">{row.domain}</td>
                        <td className="px-2 py-1">{row.valence}</td>
                        <td className="px-2 py-1">{row.name_race}</td>
                        <td className="px-2 py-1">{row.order_variant}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={startRun}
            disabled={!vignetteSet || starting || processing}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {starting ? "Starting…" : "Start rewriting run"}
          </button>
          {run && (
            <button onClick={startOver} className="text-sm text-slate-500 underline hover:text-slate-700">
              Discard current run
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      {run && progress && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="mb-2 text-sm text-slate-600">
              GPT {run.gptModelSnapshot || "(no snapshot)"} · Gemini{" "}
              {run.geminiModelSnapshot || "(no snapshot)"} · retry threshold{" "}
              {run.retryThresholdEnabled ? `${Math.round(run.retryThresholdFraction * 100)}%` : "off"} ·{" "}
              {run.selectedVignetteIds?.length ?? "?"} seed row(s) · from {run.vignetteSetFilename}
            </p>
            <div className="mb-1 flex justify-between text-sm text-slate-600">
              <span>
                {progress.done} done, {progress.error} errored, {progress.running} running,{" "}
                {progress.pending} pending (of {progress.total} generations)
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-slate-900 transition-all" style={{ width: `${pct}%` }} />
            </div>
            {processing && (
              <div className="mt-1 flex items-center gap-2">
                <p className="text-xs text-slate-500">
                  Processing batches…{" "}
                  {etaSeconds !== null
                    ? `estimated time remaining: ~${formatEta(etaSeconds)}`
                    : "estimating time remaining…"}
                </p>
                <button onClick={pauseRun} className="text-xs font-medium text-red-600 underline hover:text-red-800">
                  Pause
                </button>
              </div>
            )}
            {!processing && run.status === "paused" && (
              <div className="mt-1 flex items-center gap-2">
                <p className="text-xs text-amber-700">
                  ⚠ Paused — {progress.pending} generation{progress.pending === 1 ? "" : "s"} not yet sent.
                </p>
                <button onClick={resumeRun} className="text-xs font-medium text-slate-700 underline hover:text-slate-900">
                  Resume
                </button>
              </div>
            )}
            {failedChains.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-xs text-red-700">
                  ⚠ {failedChains.length} chain{failedChains.length === 1 ? "" : "s"} failed — never skipped, just
                  stopped: {failedChains.map((c) => `${c.id} at generation ${c.failedAtGeneration}`).join("; ")}.
                </p>
                <button
                  onClick={retryAllErrors}
                  disabled={processing}
                  title="Resets every failed chain's failed generation (and everything after it) to pending, then resumes — nothing already completed is touched. Use this after fixing whatever caused the failures, e.g. adding more API credit."
                  className="text-xs font-medium text-slate-700 underline hover:text-slate-900 disabled:opacity-50"
                >
                  Retry all errors
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => exportRun("long")}
                disabled={exporting !== null}
                title="Only generations that actually finished (status done)."
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {exporting === "long" ? "Exporting…" : "Export successful outputs CSV"}
              </button>
              <button
                onClick={() => exportRun("attempt_log")}
                disabled={exporting !== null}
                title="Every API call made, successful or not — one row per attempt."
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {exporting === "attempt_log" ? "Exporting…" : "Export attempt log CSV"}
              </button>
              <button
                onClick={() => exportRun("wide")}
                disabled={exporting !== null}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {exporting === "wide" ? "Exporting…" : "Export wide XLSX"}
              </button>
              <button
                onClick={() => exportRun("vignettes")}
                disabled={exporting !== null}
                title="Every finished generation (seed + both models' rewrites) as a Vignettes sheet, ready to re-upload into either module."
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {exporting === "vignettes" ? "Exporting…" : "Export as vignette upload"}
              </button>
            </div>
          </section>

          <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  {["chain_id", "vignette_id", "model", "Gen1", "Gen2", "Gen3", "Gen4", "Gen5", ""].map((h) => (
                    <th key={h} className="px-2 py-1 font-medium text-slate-600">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.chains.map((chain) => (
                  <Fragment key={chain.id}>
                    <tr className="border-t border-slate-100">
                      <td className="px-2 py-1 font-mono">{chain.id}</td>
                      <td className="px-2 py-1 font-mono">{chain.vignette_id}</td>
                      <td className="px-2 py-1">{chain.model}</td>
                      {chain.generations.slice(1).map((gen) => {
                        const retryKey = `${chain.id}:${gen.generation}`;
                        const canRetry =
                          chain.generations[gen.generation - 1].status === "done" && gen.status !== "running";
                        return (
                          <td key={gen.generation} className="px-2 py-1">
                            {gen.status === "pending" && <span className="text-slate-400">—</span>}
                            {gen.status === "running" && <span className="text-amber-600">running…</span>}
                            {gen.status === "error" && (
                              <span className="text-red-600" title={gen.error ?? ""}>
                                error
                              </span>
                            )}
                            {gen.status === "done" && (
                              <span className="text-slate-700">
                                {gen.actual_word_count}/{gen.target_word_count}
                                {gen.attempts.length > 1 && (
                                  <span
                                    className="ml-1 text-slate-400"
                                    title={`Complied after ${gen.attempts.length} attempts — see the attempt log export for the full per-attempt history.`}
                                  >
                                    ({gen.attempts.length}×)
                                  </span>
                                )}
                              </span>
                            )}
                            {(gen.status === "error" || canRetry) && (
                              <button
                                onClick={() => retryGeneration(chain.id, gen.generation)}
                                disabled={retrying === retryKey || processing}
                                title={
                                  processing && retrying !== retryKey
                                    ? "Wait for the current batch to finish before retrying."
                                    : undefined
                                }
                                className="ml-1 text-slate-500 underline disabled:opacity-50"
                              >
                                {retrying === retryKey ? "…" : "retry"}
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1">
                        <button
                          onClick={() => setExpanded(expanded === chain.id ? null : chain.id)}
                          className="text-slate-700 underline"
                        >
                          {expanded === chain.id ? "hide text" : "view text"}
                        </button>
                      </td>
                    </tr>
                    {expanded === chain.id && (
                      <tr className="border-t border-slate-100 bg-slate-50">
                        <td colSpan={9} className="px-2 py-3">
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {chain.generations.map((gen) => (
                              <div key={gen.generation} className="rounded-md border border-slate-200 bg-white p-2">
                                <div className="mb-1 font-medium text-slate-700">
                                  {gen.generation === 0 ? "Gen0 (seed)" : `Gen${gen.generation}`}
                                </div>
                                <p className="whitespace-pre-wrap text-slate-600">{gen.text || "—"}</p>
                                {gen.attempts.length > 1 && (
                                  <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-slate-400">
                                    <p className="font-medium text-slate-500">
                                      {gen.attempts.length - 1} earlier attempt
                                      {gen.attempts.length - 1 === 1 ? "" : "s"} missed the target before this one
                                      complied:
                                    </p>
                                    {gen.attempts.slice(0, -1).map((a) => (
                                      <p key={a.attempt}>
                                        Attempt {a.attempt} ({a.word_count} words): {a.text}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            (N×) = this generation missed its word-count target and was retried N−1 times — always
            re-reading the same source text, never its own prior attempt — before complying. A
            generation that exhausts any retry budget (word-count, API error, or refusal/empty —
            see Settings) shows as an error instead, and marks the whole chain failed at that
            generation; nothing later in that chain is ever run.
          </p>
        </>
      )}
    </div>
  );
}
