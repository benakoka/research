"use client";

import { useEffect, useRef, useState } from "react";
import VignetteUploader from "../VignetteUploader";
import { buildAttributionCells } from "@/lib/attribution";
import {
  getSettings,
  getAttributionRun,
  saveAttributionRun,
  clearAttributionRun,
} from "@/lib/clientStorage";
import { AttributionCell, AttributionRun, VignetteSet } from "@/lib/types";
import { summarizeProgress } from "@/lib/progress";
import { EtaSample, estimateEtaSeconds, formatEta, pushEtaSample } from "@/lib/eta";

// Kept small deliberately: Promise.all in the /process route waits for the
// slowest cell in a batch, so a larger batch means more concurrent cells
// sharing the risk of one being slow under real provider demand (e.g.
// Gemini taking close to its 45s timeout) — a smaller batch surfaces
// progress more often and bounds how much a single slow cell can hold up.
const BATCH_SIZE = 4;

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

export default function AttributionPage() {
  const [vignetteSet, setVignetteSet] = useState<VignetteSet | null>(null);
  const [run, setRun] = useState<AttributionRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [exporting, setExporting] = useState<"long" | "wide" | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error` (which is transient, about the last batch/export
  // action) — this one persists across renders once set, because it means
  // this browser has silently stopped being able to save the run at all
  // (most likely localStorage quota exceeded). The run keeps going in
  // memory either way, but "closing the tab loses nothing" is no longer
  // true once this is set, so it needs to stay visible until the user
  // exports (or dismisses it deliberately), not just flash by.
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const runningRef = useRef(false);
  // Checked at the top of every driveRun loop iteration (between batches) so
  // Cancel takes effect even if a batch happens to already be in flight when
  // it's clicked. abortControllerRef additionally kills whatever batch
  // request is actually in flight right now, so Cancel doesn't have to wait
  // out a slow/retrying batch (up to ~a minute with the model-call retry
  // policy) before doing anything.
  const cancelRequestedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Throughput history for the "estimated time remaining" display — see
  // lib/eta.ts. Reset at the start of every driveRun call (fresh run or
  // resume) so a slow/fast earlier session never pollutes a new one.
  const etaSamplesRef = useRef<EtaSample[]>([]);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  function completedCount(cells: AttributionCell[]) {
    return cells.filter((c) => c.status === "done" || c.status === "error").length;
  }

  function persist(updated: AttributionRun) {
    setRun(updated);
    const ok = saveAttributionRun(updated);
    if (!ok) {
      setStorageWarning(
        "This browser's storage is full, so new results are no longer being saved — they only exist in this tab until you export. Export now, or free up space (clear old runs/other sites' data) and reload to resume normal saving."
      );
    }
  }

  async function processBatch(cells: AttributionCell[], promptTemplate: string, signal?: AbortSignal) {
    const res = await fetch("/api/attribution/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cells, promptTemplate }),
      signal,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Batch failed.");
    return body.cells as AttributionCell[];
  }

  async function driveRun(current: AttributionRun) {
    if (runningRef.current) return;
    runningRef.current = true;
    setProcessing(true);
    setError(null);
    cancelRequestedRef.current = false;
    // Seed with "now, at whatever's already done" — matters for a resumed
    // run (page refresh mid-run), where cells completed in a prior session
    // shouldn't count toward this session's measured rate.
    etaSamplesRef.current = [{ t: Date.now(), n: completedCount(current.cells) }];
    setEtaSeconds(null);
    try {
      let working = current;
      while (true) {
        if (cancelRequestedRef.current) {
          persist({ ...working, status: "cancelled" });
          return;
        }
        const pending = working.cells.filter((c) => c.status === "pending").slice(0, BATCH_SIZE);
        if (pending.length === 0) break;

        const controller = new AbortController();
        abortControllerRef.current = controller;
        let results: AttributionCell[];
        try {
          results = await processBatch(pending, working.promptTemplate, controller.signal);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            persist({ ...working, status: "cancelled" });
            return;
          }
          throw err;
        } finally {
          abortControllerRef.current = null;
        }

        const byId = new Map(results.map((c) => [c.id, c]));
        const cells = working.cells.map((c) => byId.get(c.id) ?? c);
        working = { ...working, status: "running", cells };
        persist(working);

        const n = completedCount(cells);
        etaSamplesRef.current = pushEtaSample(etaSamplesRef.current, { t: Date.now(), n });
        setEtaSeconds(estimateEtaSeconds(etaSamplesRef.current, cells.length - n));
      }
      const done = { ...working, status: "done" as const };
      persist(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch failed.");
    } finally {
      runningRef.current = false;
      setProcessing(false);
      setEtaSeconds(null);
    }
  }

  function cancelRun() {
    if (
      !confirm(
        "Cancel this run? Whatever's already completed stays — you can export it — but nothing still pending will be sent."
      )
    )
      return;
    cancelRequestedRef.current = true;
    abortControllerRef.current?.abort();
  }

  useEffect(() => {
    (async () => {
      const stored = getAttributionRun();
      setRun(stored);
      // Resume automatically if the page was refreshed mid-run — but not a
      // run the user deliberately cancelled.
      if (
        stored &&
        stored.status !== "cancelled" &&
        stored.cells.some((c) => c.status === "pending" || c.status === "running")
      ) {
        // Any cell left "running" from a torn-down tab needs to go back to
        // pending before we can pick it up again.
        const cells = stored.cells.map((c) => (c.status === "running" ? { ...c, status: "pending" as const } : c));
        const resumed = { ...stored, cells };
        driveRun(resumed);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRun() {
    if (!vignetteSet) return;
    if (run && run.cells.some((c) => c.status !== "done" && c.status !== "error")) {
      if (!confirm("There's an unfinished run. Starting a new one replaces it. Continue?")) return;
    }
    setStarting(true);
    setError(null);
    try {
      const settings = getSettings();
      const cells = buildAttributionCells(
        vignetteSet.rows,
        settings.defaultRepCount,
        settings.gptModelSnapshot,
        settings.geminiModelSnapshot
      );
      const newRun: AttributionRun = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        promptTemplate: settings.attributionPromptTemplate,
        repCount: settings.defaultRepCount,
        gptModelSnapshot: settings.gptModelSnapshot,
        geminiModelSnapshot: settings.geminiModelSnapshot,
        vignetteSetFilename: vignetteSet.filename,
        cells,
        status: "pending",
      };
      persist(newRun);
      driveRun(newRun);
    } finally {
      setStarting(false);
    }
  }

  async function retryCell(cellId: string) {
    if (!run) return;
    // Guard against the same race the batch driver protects itself from:
    // if a driveRun loop is already in flight, it holds its own `working`
    // copy of the cells and will persist() that on its next iteration,
    // silently overwriting whatever this retry just wrote. The retry
    // button is also disabled while `processing` is true (see JSX below),
    // so this is defense in depth for the moment between a click and the
    // disabled state re-rendering.
    if (runningRef.current) return;
    setRetrying(cellId);
    setError(null);
    try {
      const target = run.cells.find((c) => c.id === cellId);
      if (!target) return;
      const reset = { ...target, status: "pending" as const, error: null, parse_error: null };
      const results = await processBatch([reset], run.promptTemplate);
      const updatedCell = results[0];
      const cells = run.cells.map((c) => (c.id === cellId ? updatedCell : c));
      persist({ ...run, cells });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetrying(null);
    }
  }

  async function exportRun(format: "long" | "wide") {
    if (!run) return;
    setExporting(format);
    setError(null);
    try {
      const res = await fetch("/api/attribution/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells: run.cells, format }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Export failed.");
      }
      const blob = await res.blob();
      downloadBlob(blob, `attribution_${format}.${format === "long" ? "csv" : "xlsx"}`);
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

  function startOver() {
    if (!confirm("Discard the current run? This can't be undone unless you've already exported it.")) return;
    clearAttributionRun();
    setRun(null);
  }

  const progress = run ? summarizeProgress(run.cells.map((c) => c.status)) : null;
  const pct = progress && progress.total > 0 ? Math.round(((progress.done + progress.error) / progress.total) * 100) : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Attribution module</h1>
        <p className="mt-1 text-sm text-slate-600">
          Rates each vignette twice per model (as-written and gender-flipped
          scale direction), at the rep count configured in Settings. Nothing
          is saved on a server — this run lives in your browser until you
          export it.
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
        <VignetteUploader value={vignetteSet} onChange={setVignetteSet} />
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={startRun}
            disabled={!vignetteSet || starting || processing}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {starting ? "Starting…" : "Start attribution run"}
          </button>
          {run && (
            <button
              onClick={startOver}
              className="text-sm text-slate-500 underline hover:text-slate-700"
            >
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
              {run.geminiModelSnapshot || "(no snapshot)"} · rep count {run.repCount} · from{" "}
              {run.vignetteSetFilename}
            </p>
            <div className="mb-1 flex justify-between text-sm text-slate-600">
              <span>
                {progress.done} done, {progress.error} errored, {progress.running} running,{" "}
                {progress.pending} pending (of {progress.total})
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
                <button onClick={cancelRun} className="text-xs font-medium text-red-600 underline hover:text-red-800">
                  Cancel
                </button>
              </div>
            )}
            {run.status === "cancelled" && (
              <p className="mt-1 text-xs text-amber-700">
                ⚠ Cancelled — {progress.pending} cell{progress.pending === 1 ? "" : "s"} never got sent. Export what
                you have below, or start a new run (this one will be replaced, not continued).
              </p>
            )}

            <div className="mt-4 flex gap-3">
              <button
                onClick={() => exportRun("long")}
                disabled={exporting !== null}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {exporting === "long" ? "Exporting…" : "Export long CSV"}
              </button>
              <button
                onClick={() => exportRun("wide")}
                disabled={exporting !== null}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {exporting === "wide" ? "Exporting…" : "Export wide XLSX"}
              </button>
            </div>
          </section>

          <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  {["vignette_id", "direction", "model", "rep", "status", "rating", "+50", "-50", "error", ""].map((h) => (
                    <th key={h} className="px-2 py-1 font-medium text-slate-600">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.cells.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-2 py-1 font-mono">{c.vignette_id}</td>
                    <td className="px-2 py-1">{c.scale_direction}</td>
                    <td className="px-2 py-1">{c.model}</td>
                    <td className="px-2 py-1">{c.rep}</td>
                    <td className="px-2 py-1">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs " +
                          (c.status === "done"
                            ? "bg-green-100 text-green-700"
                            : c.status === "error"
                            ? "bg-red-100 text-red-700"
                            : c.status === "running"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-500")
                        }
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-2 py-1">{c.rating ?? "—"}</td>
                    <td className="px-2 py-1">{c.plus50_name}</td>
                    <td className="px-2 py-1">{c.minus50_name}</td>
                    <td className="max-w-xs truncate px-2 py-1 text-red-600" title={c.error ?? c.parse_error ?? ""}>
                      {c.error ?? c.parse_error ?? ""}
                    </td>
                    <td className="px-2 py-1">
                      {(c.status === "error" || c.parse_error) && (
                        <button
                          onClick={() => retryCell(c.id)}
                          disabled={retrying === c.id || processing}
                          title={
                            processing && retrying !== c.id
                              ? "Wait for the current batch to finish before retrying."
                              : undefined
                          }
                          className="text-slate-700 underline disabled:opacity-50"
                        >
                          {retrying === c.id ? "…" : "Retry"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
