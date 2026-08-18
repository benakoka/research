"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import VignetteUploader from "../VignetteUploader";
import { AttributionRun } from "@/lib/types";

export default function AttributionPage() {
  const router = useRouter();
  const [vignetteSetId, setVignetteSetId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AttributionRun[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/attribution/runs")
      .then((r) => r.json())
      .then(setRuns);
  }, []);

  async function startRun() {
    if (!vignetteSetId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/attribution/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vignetteSetId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not start run.");
      router.push(`/attribution/runs/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start run.");
      setStarting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Attribution module</h1>
        <p className="mt-1 text-sm text-slate-600">
          Rates each vignette twice per model (as-written and gender-flipped
          scale direction), at the rep count configured in Settings.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-semibold text-slate-900">Start a new run</h2>
        <VignetteUploader selectedId={vignetteSetId} onSelect={setVignetteSetId} />
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={startRun}
            disabled={!vignetteSetId || starting}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {starting ? "Starting…" : "Start attribution run"}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Past runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <a href={`/attribution/runs/${r.id}`} className="font-medium text-slate-800 underline">
                    Run {r.id.slice(0, 8)}
                  </a>
                  <div className="text-slate-500">
                    {new Date(r.createdAt).toLocaleString()} · GPT {r.gptModelSnapshot || "(no snapshot)"} ·
                    {" "}Gemini {r.geminiModelSnapshot || "(no snapshot)"} · rep count {r.repCount}
                  </div>
                </div>
                <span
                  className={
                    "rounded-full px-2 py-1 text-xs font-medium " +
                    (r.status === "done"
                      ? "bg-green-100 text-green-700"
                      : r.status === "running"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-600")
                  }
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
