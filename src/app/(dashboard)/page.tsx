import Link from "next/link";
import {
  listVignetteSets,
  listAttributionRuns,
  listRewritingRuns,
} from "@/lib/store";

export default async function HomePage() {
  const [vignetteSets, attrRuns, rwRuns] = await Promise.all([
    listVignetteSets(),
    listAttributionRuns(),
    listRewritingRuns(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Whose side is AI on? — AI-only pilot tool
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Two independent modules: Attribution rating and Rewriting chains.
          Both start from a vignette set you upload — the site holds no
          vignette data of its own.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          href="/attribution"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-400"
        >
          <h2 className="font-semibold text-slate-900">Attribution module</h2>
          <p className="mt-1 text-sm text-slate-500">
            {attrRuns.length} run{attrRuns.length === 1 ? "" : "s"} so far.
          </p>
        </Link>
        <Link
          href="/rewriting"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-400"
        >
          <h2 className="font-semibold text-slate-900">Rewriting module</h2>
          <p className="mt-1 text-sm text-slate-500">
            {rwRuns.length} run{rwRuns.length === 1 ? "" : "s"} so far.
          </p>
        </Link>
        <Link
          href="/settings"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-400"
        >
          <h2 className="font-semibold text-slate-900">Settings</h2>
          <p className="mt-1 text-sm text-slate-500">
            API keys, model snapshots, prompt templates, defaults.
          </p>
        </Link>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Uploaded vignette sets
        </h2>
        {vignetteSets.length === 0 ? (
          <p className="text-sm text-slate-500">
            None uploaded yet. Upload a vignette set from the Attribution or
            Rewriting page to get started.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {vignetteSets.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-medium text-slate-800">{s.filename}</span>
                <span className="text-slate-500">
                  {s.rows.length} rows · uploaded {new Date(s.uploadedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
