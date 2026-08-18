"use client";

import { useEffect, useRef, useState } from "react";
import VignetteUploader from "../VignetteUploader";
import { buildAttributionCells } from "@/lib/attribution";
import {
  getSettings,
  getAttributionRun,
  saveAttributionRun,
  clearAttributionRun,
  addUsage,
} from "@/lib/clientStorage";
import { AttributionCell, AttributionRun, ModelProvider, VignetteSet } from "@/lib/types";
import { summarizeProgress } from "@/lib/progress";

const BATCH_SIZE = 8;

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
  const runningRef = useRef(false);

  function persist(updated: AttributionRun) {
    setRun(updated);
    saveAttributionRun(updated);
  }

  async function processBatch(cells: AttributionCell[], promptTemplate: string) {
    const res = await fetch("/api/attribution/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cells, promptTemplate }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Batch failed.");
    addUsage(body.usage as Record<ModelProvider, { calls: number; inputTokens: number; outputTokens: number }>);
    return body.cells as AttributionCell[];
  }

  async function driveRun(current: AttributionRun) {
    if (runningRef.current) return;
    runningRef.current = true;
    setProcessing(true);
    setError(null);
    try {
      let working = current;
      while (true) {
        const pending = working.cells.filter((c) => c.status === "pending").slice(0, BATCH_SIZE);
        if (pending.length === 0) break;
        const results = await processBatch(pending, working.promptTemplate);
        const byId = new Map(results.map((c) => [c.id, c]));
        const cells = working.cells.map((c) => byId.get(c.id) ?? c);
        working = { ...working, status: "running", cells };
        persist(working);
      }
      const done = { ...working, status: "done" as const };
      persist(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch failed.");
    } finally {
      runningRef.current = false;
      setProcessing(false);
    }
  }

  useEffect(() => {
    (async () => {
      const stored = getAttributionRun();
      setRun(stored);
      // Resume automatically if the page was refreshed mid-run.
      if (stored && stored.cells.some((c) => c.status === "pending" || c.status === "running")) {
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
            {processing && <p className="mt-1 text-xs text-slate-500">Processing batches…</p>}

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
                          disabled={retrying === c.id}
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
