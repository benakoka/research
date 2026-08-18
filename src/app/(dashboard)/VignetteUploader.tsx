"use client";

import { useEffect, useState } from "react";
import { VignetteSet } from "@/lib/types";
import { getVignetteSet, saveVignetteSet } from "@/lib/clientStorage";

export default function VignetteUploader({
  value,
  onChange,
}: {
  value: VignetteSet | null;
  onChange: (set: VignetteSet) => void;
}) {
  const [warnings, setWarnings] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);

  // Pick up whatever was uploaded last time this browser was here — there's
  // no server list to fetch from, just this one localStorage-backed set.
  useEffect(() => {
    if (!value) {
      const stored = getVignetteSet();
      if (stored) onChange(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/vignettes/parse", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed.");
      const set: VignetteSet = { filename: body.filename, uploadedAt: body.uploadedAt, rows: body.rows };
      saveVignetteSet(set);
      onChange(set);
      setWarnings(body.warnings ?? []);
      setShowReview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {uploading ? "Uploading…" : "Upload vignette_upload_template.xlsx"}
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {value && (
        <p className="text-sm text-slate-600">
          Currently loaded: <span className="font-medium text-slate-800">{value.filename}</span> —{" "}
          {value.rows.length} rows, uploaded {new Date(value.uploadedAt).toLocaleString()}.{" "}
          Uploading a new file replaces this.
        </p>
      )}

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}

      {value && (
        <div>
          <button
            onClick={() => setShowReview((s) => !s)}
            className="text-sm font-medium text-slate-700 underline"
          >
            {showReview ? "Hide" : "Show"} review table ({value.rows.length} rows)
          </button>
          {showReview && (
            <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    {["vignette_id", "domain", "valence", "scenario_number", "order_variant", "female_name", "male_name", "vignette_text"].map(
                      (h) => (
                        <th key={h} className="px-2 py-1 font-medium text-slate-600">
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {value.rows.map((row) => (
                    <tr key={row.vignette_id} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-mono">{row.vignette_id}</td>
                      <td className="px-2 py-1">{row.domain}</td>
                      <td className="px-2 py-1">{row.valence}</td>
                      <td className="px-2 py-1">{row.scenario_number}</td>
                      <td className="px-2 py-1">{row.order_variant}</td>
                      <td className="px-2 py-1">{row.female_name}</td>
                      <td className="px-2 py-1">{row.male_name}</td>
                      <td className="max-w-md truncate px-2 py-1" title={row.vignette_text}>
                        {row.vignette_text}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
