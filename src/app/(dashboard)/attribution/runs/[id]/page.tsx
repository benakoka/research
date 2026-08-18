"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { AttributionCell, AttributionRun } from "@/lib/types";
import { ProgressSummary } from "@/lib/progress";

export default function AttributionRunPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<AttributionRun | null>(null);
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [cells, setCells] = useState<AttributionCell[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const runningRef = useRef(false);

  const refreshCells = useCallback(() => {
    fetch(`/api/attribution/runs/${id}/cells`)
      .then((r) => r.json())
      .then(setCells);
  }, [id]);

  useEffect(() => {
    fetch(`/api/attribution/runs/${id}`)
      .then((r) => r.json())
      .then((body) => {
        setRun(body.run);
        setProgress(body.progress);
      });
    refreshCells();
  }, [id, refreshCells]);

  // Drive the batch worker: keep calling /process until it reports done.
  useEffect(() => {
    if (runningRef.current) return;
    if (!progress) return;
    if (progress.pending === 0 && progress.running === 0) return;

    runningRef.current = true;

    let cancelled = false;
    (async () => {
      setProcessing(true);
      while (!cancelled) {
        const res = await fetch(`/api/attribution/runs/${id}/process`, { method: "POST" });
        const body = await res.json();
        if (cancelled) break;
        setProgress(body.progress);
        refreshCells();
        if (body.done) break;
      }
      runningRef.current = false;
      setProcessing(false);
    })();

    return () => {
      cancelled = true;
    };
    // Only (re-)start the worker when we transition into a non-idle run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, progress === null]);

  async function retryCell(cellId: string) {
    setRetrying(cellId);
    try {
      await fetch(`/api/attribution/runs/${id}/cells/${cellId}/retry`, { method: "POST" });
      refreshCells();
      const res = await fetch(`/api/attribution/runs/${id}`);
      const body = await res.json();
      setProgress(body.progress);
    } finally {
      setRetrying(null);
    }
  }

  if (!run || !progress) return <p className="text-sm text-slate-500">Loading…</p>;

  const pct = progress.total === 0 ? 0 : Math.round(((progress.done + progress.error) / progress.total) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Attribution run {run.id.slice(0, 8)}</h1>
        <p className="mt-1 text-sm text-slate-600">
          GPT {run.gptModelSnapshot || "(no snapshot)"} · Gemini {run.geminiModelSnapshot || "(no snapshot)"} · rep
          count {run.repCount}
        </p>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-sm text-slate-600">
          <span>
            {progress.done} done, {progress.error} errored, {progress.running} running, {progress.pending} pending
            {" "}(of {progress.total})
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-slate-900 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {processing && <p className="mt-1 text-xs text-slate-500">Processing batches…</p>}
      </div>

      <div className="flex gap-3">
        <a
          href={`/api/attribution/runs/${id}/export?format=long`}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Export long CSV
        </a>
        <a
          href={`/api/attribution/runs/${id}/export?format=wide`}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Export wide XLSX
        </a>
      </div>

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
            {cells.map((c) => (
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
    </div>
  );
}
