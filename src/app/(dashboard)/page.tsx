"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getVignetteSet, getAttributionRun, getRewritingRun } from "@/lib/clientStorage";
import { VignetteSet, AttributionRun, RewritingRun } from "@/lib/types";

export default function HomePage() {
  const [vignetteSet, setVignetteSet] = useState<VignetteSet | null>(null);
  const [attrRun, setAttrRun] = useState<AttributionRun | null>(null);
  const [rwRun, setRwRun] = useState<RewritingRun | null>(null);

  useEffect(() => {
    (async () => {
      setVignetteSet(getVignetteSet());
      setAttrRun(getAttributionRun());
      setRwRun(getRewritingRun());
    })();
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Whose side is AI on? — AI-only pilot tool
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Two independent modules: Attribution rating and Rewriting chains.
          Both start from a vignette set you upload. Nothing is stored on a
          server — everything here lives in this browser until you export
          it, so download your results before clearing browser data or
          switching machines.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          href="/attribution"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-400"
        >
          <h2 className="font-semibold text-slate-900">Attribution module</h2>
          <p className="mt-1 text-sm text-slate-500">
            {attrRun ? `In-browser run: ${attrRun.status}` : "No run yet."}
          </p>
        </Link>
        <Link
          href="/rewriting"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-400"
        >
          <h2 className="font-semibold text-slate-900">Rewriting module</h2>
          <p className="mt-1 text-sm text-slate-500">
            {rwRun ? `In-browser run: ${rwRun.status}` : "No run yet."}
          </p>
        </Link>
        <Link
          href="/settings"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-400"
        >
          <h2 className="font-semibold text-slate-900">Settings</h2>
          <p className="mt-1 text-sm text-slate-500">
            Model snapshots, prompt templates, defaults.
          </p>
        </Link>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Current vignette set</h2>
        {vignetteSet ? (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm">
            <span className="font-medium text-slate-800">{vignetteSet.filename}</span>
            <span className="text-slate-500">
              {vignetteSet.rows.length} rows · uploaded {new Date(vignetteSet.uploadedAt).toLocaleString()}
            </span>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            None uploaded yet. Upload a vignette set from the Attribution or
            Rewriting page to get started.
          </p>
        )}
      </div>
    </div>
  );
}
