"use client";

import { useEffect, useState } from "react";
import { getSettings, saveSettings, getUsage } from "@/lib/clientStorage";
import { summarizeCost, CostSummary } from "@/lib/cost";
import { Settings } from "@/lib/types";

interface KeyStatus {
  openaiApiKeyMasked: string | null;
  geminiApiKeyMasked: string | null;
  testMode: boolean;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {hint && <p className="mb-1 text-xs text-slate-500">{hint}</p>}
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-500";

export default function SettingsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [costs, setCosts] = useState<CostSummary[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const settings = getSettings();
      setData(settings);
      setCosts(summarizeCost(getUsage(), settings));
      try {
        const res = await fetch("/api/settings");
        setKeyStatus(await res.json());
      } catch {
        setError("Couldn't reach the server to check API key status.");
      }
    })();
  }, []);

  if (!data) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  function saveAll() {
    if (!data) return;
    const saved = saveSettings(data);
    setData(saved);
    setCosts(summarizeCost(getUsage(), saved));
    setSavedAt(Date.now());
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setData((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Editable at any time. Everything below lives in this browser&apos;s
          localStorage, not a server database — there&apos;s nothing to save
          anywhere else. Clearing this browser&apos;s data resets it back to
          defaults.
        </p>
      </div>

      {keyStatus?.testMode && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠ <strong>Test mode is on</strong> (<code>USE_CLAUDE_FOR_TESTING=true</code>).
          Both the &quot;GPT&quot; and &quot;Gemini&quot; slots below are actually calling
          Claude via <code>ANTHROPIC_API_KEY</code> — type a real Claude model ID (e.g.{" "}
          <code>claude-haiku-4-5-20251001</code>) into both model snapshot fields for this
          to work. This is for exercising the upload → run → export pipeline only — Claude
          output is not a substitute for real GPT/Gemini data.
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-semibold text-slate-900">API keys</h2>
        <p className="mb-4 text-xs text-slate-500">
          Set as Vercel environment variables (<code>OPENAI_API_KEY</code>,{" "}
          <code>GEMINI_API_KEY</code>) rather than here — they&apos;re
          operator-level secrets, not per-run configuration, and this keeps
          them out of any browser storage entirely. Change them from the
          Vercel project settings (or <code>.env.local</code> for local
          dev); this screen just shows whether one is currently configured.
        </p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-md bg-slate-50 p-3">
            <div className="font-medium text-slate-700">OpenAI</div>
            <div className="text-slate-600">
              {keyStatus?.openaiApiKeyMasked ? `Configured (${keyStatus.openaiApiKeyMasked})` : "Not set"}
            </div>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <div className="font-medium text-slate-700">Gemini</div>
            <div className="text-slate-600">
              {keyStatus?.geminiApiKeyMasked ? `Configured (${keyStatus.geminiApiKeyMasked})` : "Not set"}
            </div>
          </div>
        </div>
        {keyStatus?.testMode && (
          <p className="mt-3 text-xs text-amber-700">
            Test mode is on, so both cards above actually reflect{" "}
            <code>ANTHROPIC_API_KEY</code>, not the OpenAI/Gemini keys.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-semibold text-slate-900">Model snapshots</h2>
        <p className="mb-4 text-xs text-slate-500">
          Free text, used for every API call in both modules. There is no
          default baked in — flagship versions cycle too often for that.
        </p>
        <Field label="GPT model snapshot" hint="e.g. gpt-5.2">
          <input
            value={data.gptModelSnapshot}
            onChange={(e) => update("gptModelSnapshot", e.target.value)}
            className={inputClass + " font-mono"}
          />
        </Field>
        <Field label="Gemini model snapshot" hint="e.g. gemini-3-pro">
          <input
            value={data.geminiModelSnapshot}
            onChange={(e) => update("geminiModelSnapshot", e.target.value)}
            className={inputClass + " font-mono"}
          />
        </Field>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-semibold text-slate-900">Prompt templates</h2>
        <Field
          label="Attribution rating prompt"
          hint="Must contain [FEMALE NAME] and [MALE NAME]. Shipped default is the exact wording confirmed for the pilot — edit with care."
        >
          <textarea
            value={data.attributionPromptTemplate}
            onChange={(e) => update("attributionPromptTemplate", e.target.value)}
            rows={6}
            className={inputClass + " font-mono"}
          />
        </Field>
        <Field
          label="Rewriting prompt"
          hint="Must contain [TARGET WORD COUNT]."
        >
          <textarea
            value={data.rewritingPromptTemplate}
            onChange={(e) => update("rewritingPromptTemplate", e.target.value)}
            rows={6}
            className={inputClass + " font-mono"}
          />
        </Field>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-semibold text-slate-900">Attribution defaults</h2>
        <Field
          label="Default rep count"
          hint="Confirmed default is 1 — each text × scale direction × model runs once. Raise only for deliberate repeated sampling."
        >
          <input
            type="number"
            min={1}
            value={data.defaultRepCount}
            onChange={(e) => update("defaultRepCount", Number(e.target.value))}
            className={inputClass + " max-w-[8rem]"}
          />
        </Field>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-semibold text-slate-900">Rewriting defaults</h2>
        <Field label="Per-generation word-count targets" hint="Generations 1 through 5, in order.">
          <div className="flex gap-2">
            {data.defaultWordCountTargets.map((v, i) => (
              <input
                key={i}
                type="number"
                min={1}
                value={v}
                onChange={(e) => {
                  const next = [...data.defaultWordCountTargets] as typeof data.defaultWordCountTargets;
                  next[i] = Number(e.target.value);
                  update("defaultWordCountTargets", next);
                }}
                className={inputClass + " w-20"}
              />
            ))}
          </div>
        </Field>
        <Field
          label="Retry threshold"
          hint="Retry once, automatically, if a generation misses its target by more than this fraction. Adjustable, not a hardcoded magic number."
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(data.retryThresholdFraction * 100)}
              onChange={(e) => update("retryThresholdFraction", Number(e.target.value) / 100)}
              className={inputClass + " w-24"}
            />
            <span className="text-sm text-slate-500">%</span>
          </div>
        </Field>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-semibold text-slate-900">Cost visibility</h2>
        <p className="mb-4 text-xs text-slate-500">
          Rough running estimate only, accumulated in this browser across
          every batch it has run — there is no spending cap in this app.
          Manage budget limits directly in the OpenAI/Google billing
          platforms. Enter $/1M token pricing below to see a dollar estimate;
          call counts are always shown regardless.
        </p>
        <div className="mb-4 grid grid-cols-2 gap-4">
          {costs.map((c) => (
            <div key={c.model} className="rounded-md bg-slate-50 p-3 text-sm">
              <div className="font-mono font-medium">{c.model}</div>
              <div className="text-slate-600">
                {c.calls} calls · {c.inputTokens.toLocaleString()} in / {c.outputTokens.toLocaleString()} out tok
                {c.estimatedCostUsd !== null && ` · ~$${c.estimatedCostUsd.toFixed(2)}`}
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="mb-2 text-xs font-medium text-slate-600">GPT pricing ($ / 1M tokens)</p>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="input"
                value={data.gptPricing.inputPerMillion || ""}
                onChange={(e) =>
                  update("gptPricing", { ...data.gptPricing, inputPerMillion: Number(e.target.value) })
                }
                className={inputClass}
              />
              <input
                type="number"
                placeholder="output"
                value={data.gptPricing.outputPerMillion || ""}
                onChange={(e) =>
                  update("gptPricing", { ...data.gptPricing, outputPerMillion: Number(e.target.value) })
                }
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-slate-600">Gemini pricing ($ / 1M tokens)</p>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="input"
                value={data.geminiPricing.inputPerMillion || ""}
                onChange={(e) =>
                  update("geminiPricing", { ...data.geminiPricing, inputPerMillion: Number(e.target.value) })
                }
                className={inputClass}
              />
              <input
                type="number"
                placeholder="output"
                value={data.geminiPricing.outputPerMillion || ""}
                onChange={(e) =>
                  update("geminiPricing", { ...data.geminiPricing, outputPerMillion: Number(e.target.value) })
                }
                className={inputClass}
              />
            </div>
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={saveAll}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Save settings
        </button>
        {savedAt && <span className="text-xs text-slate-500">Saved.</span>}
      </div>
    </div>
  );
}
