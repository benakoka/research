"use client";

import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { RewritingChain, RewritingRun } from "@/lib/types";
import { ProgressSummary } from "@/lib/progress";
import { missesTarget } from "@/lib/wordcount";

export default function RewritingRunPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RewritingRun | null>(null);
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [chains, setChains] = useState<RewritingChain[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const runningRef = useRef(false);

  const refreshChains = useCallback(() => {
    fetch(`/api/rewriting/runs/${id}/chains`)
      .then((r) => r.json())
      .then(setChains);
  }, [id]);

  useEffect(() => {
    fetch(`/api/rewriting/runs/${id}`)
      .then((r) => r.json())
      .then((body) => {
        setRun(body.run);
        setProgress(body.progress);
      });
    refreshChains();
  }, [id, refreshChains]);

  useEffect(() => {
    if (runningRef.current) return;
    if (!progress) return;
    if (progress.pending === 0 && progress.running === 0) return;

    runningRef.current = true;
    let cancelled = false;
    (async () => {
      setProcessing(true);
      while (!cancelled) {
        const res = await fetch(`/api/rewriting/runs/${id}/process`, { method: "POST" });
        const body = await res.json();
        if (cancelled) break;
        setProgress(body.progress);
        refreshChains();
        if (body.done) break;
      }
      runningRef.current = false;
      setProcessing(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, progress === null]);

  async function retryGeneration(chainId: string, gen: number) {
    const key = `${chainId}:${gen}`;
    setRetrying(key);
    try {
      await fetch(`/api/rewriting/runs/${id}/chains/${chainId}/generations/${gen}/retry`, {
        method: "POST",
      });
      refreshChains();
      const res = await fetch(`/api/rewriting/runs/${id}`);
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
        <h1 className="text-xl font-semibold text-slate-900">Rewriting run {run.id.slice(0, 8)}</h1>
        <p className="mt-1 text-sm text-slate-600">
          GPT {run.gptModelSnapshot || "(no snapshot)"} · Gemini {run.geminiModelSnapshot || "(no snapshot)"} · retry
          threshold {Math.round(run.retryThresholdFraction * 100)}%
        </p>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-sm text-slate-600">
          <span>
            {progress.done} done, {progress.error} errored, {progress.running} running, {progress.pending} pending
            {" "}(of {progress.total} generations)
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
          href={`/api/rewriting/runs/${id}/export?format=long`}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Export long CSV
        </a>
        <a
          href={`/api/rewriting/runs/${id}/export?format=wide`}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Export wide XLSX
        </a>
      </div>

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
            {chains.map((chain) => (
              <Fragment key={chain.id}>
                <tr className="border-t border-slate-100">
                  <td className="px-2 py-1 font-mono">{chain.id}</td>
                  <td className="px-2 py-1 font-mono">{chain.vignette_id}</td>
                  <td className="px-2 py-1">{chain.model}</td>
                  {chain.generations.slice(1).map((gen) => {
                    const missed =
                      gen.status === "done" &&
                      gen.target_word_count !== null &&
                      missesTarget(gen.actual_word_count, gen.target_word_count, run.retryThresholdFraction);
                    const retryKey = `${chain.id}:${gen.generation}`;
                    const canRetry = chain.generations[gen.generation - 1].status === "done" && gen.status !== "running";
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
                          <span className={missed ? "font-medium text-red-600" : "text-slate-700"}>
                            {gen.actual_word_count}/{gen.target_word_count}
                            {gen.retried && "*"}
                          </span>
                        )}
                        {(gen.status === "error" || canRetry) && (
                          <button
                            onClick={() => retryGeneration(chain.id, gen.generation)}
                            disabled={retrying === retryKey}
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
                            {gen.retried && gen.first_attempt_text && (
                              <p className="mt-2 text-slate-400">
                                First attempt ({gen.first_attempt_word_count} words):{" "}
                                {gen.first_attempt_text}
                              </p>
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
      <p className="text-xs text-slate-500">* = retried once after missing its target by more than the configured threshold.</p>
    </div>
  );
}
