"use client";

import { useEffect, useState } from "react";
import { getSettings, saveSettings } from "@/lib/clientStorage";
import { Settings } from "@/lib/types";

interface KeyStatus {
  openaiApiKeyMasked: string | null;
  geminiApiKeyMasked: string | null;
  testMode: boolean;
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  return (
    <div className="mb-5">
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mb-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

/** Clamps a settings number field to a positive integer — never let 0,
 * negative, or fractional values reach a run (e.g. a rep count of 0 builds
 * zero cells and "Start run" silently does nothing). */
function clampPositiveInt(raw: string, fallback = 1): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-500";

// Cheapest current Claude model — good for stretching a small test-mode
// budget across a lot of calls. Only surfaced as a suggestion when test
// mode is on; not used anywhere by default.
const SUGGESTED_TEST_MODEL = "claude-haiku-4-5-20251001";

export default function SettingsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Number fields hold whatever's being typed here — free-form, uncommitted
  // — and only clamp/commit into `data` on blur. Clamping on every keystroke
  // (the first pass at this fix) meant clearing a field to type a new value
  // snapped it back to the old one before you could finish typing, since an
  // in-progress "" or partial value is momentarily invalid. `null` = not
  // currently being edited, so the input falls back to displaying `data`.
  const [repCountRaw, setRepCountRaw] = useState<string | null>(null);
  const [wordCountRaw, setWordCountRaw] = useState<(string | null)[]>([null, null, null, null, null]);
  const [retryThresholdRaw, setRetryThresholdRaw] = useState<string | null>(null);

  async function copySuggestedModel() {
    await navigator.clipboard.writeText(SUGGESTED_TEST_MODEL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  useEffect(() => {
    (async () => {
      setData(getSettings());
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
    setData(saveSettings(data));
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
          Manage spending caps directly in the OpenAI/Google billing
          dashboards — this app doesn&apos;t track or limit cost.
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
        {keyStatus?.testMode && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <span>
              Test mode suggestion — paste this into both fields below:{" "}
              <code className="rounded bg-white px-1.5 py-0.5">{SUGGESTED_TEST_MODEL}</code>
            </span>
            <button
              onClick={copySuggestedModel}
              className="ml-auto shrink-0 rounded-md border border-amber-400 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        )}
        <Field label="GPT model snapshot" htmlFor="gpt-model-snapshot" hint="e.g. gpt-5.2">
          <input
            id="gpt-model-snapshot"
            aria-describedby="gpt-model-snapshot-hint"
            value={data.gptModelSnapshot}
            onChange={(e) => update("gptModelSnapshot", e.target.value)}
            className={inputClass + " font-mono"}
          />
        </Field>
        <Field label="Gemini model snapshot" htmlFor="gemini-model-snapshot" hint="e.g. gemini-3-pro">
          <input
            id="gemini-model-snapshot"
            aria-describedby="gemini-model-snapshot-hint"
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
          htmlFor="attribution-prompt"
          hint="Must contain [FEMALE NAME] and [MALE NAME]. Shipped default is the exact wording confirmed for the pilot — edit with care."
        >
          <textarea
            id="attribution-prompt"
            aria-describedby="attribution-prompt-hint"
            value={data.attributionPromptTemplate}
            onChange={(e) => update("attributionPromptTemplate", e.target.value)}
            rows={6}
            className={inputClass + " font-mono"}
          />
        </Field>
        <Field label="Rewriting prompt" htmlFor="rewriting-prompt" hint="Must contain [TARGET WORD COUNT].">
          <textarea
            id="rewriting-prompt"
            aria-describedby="rewriting-prompt-hint"
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
          htmlFor="default-rep-count"
          hint="Confirmed default is 1 — each text × scale direction × model runs once. Raise only for deliberate repeated sampling. Whole numbers, 1 or greater."
        >
          <input
            id="default-rep-count"
            aria-describedby="default-rep-count-hint"
            type="number"
            min={1}
            step={1}
            value={repCountRaw ?? String(data.defaultRepCount)}
            onChange={(e) => setRepCountRaw(e.target.value)}
            onBlur={() => {
              if (repCountRaw === null) return;
              update("defaultRepCount", clampPositiveInt(repCountRaw, data.defaultRepCount));
              setRepCountRaw(null);
            }}
            className={inputClass + " max-w-[8rem]"}
          />
        </Field>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-semibold text-slate-900">Rewriting defaults</h2>
        <fieldset className="mb-5">
          <legend className="mb-1 block text-sm font-medium text-slate-700">
            Per-generation word-count targets
          </legend>
          <p id="word-count-targets-hint" className="mb-1 text-xs text-slate-500">
            Generations 1 through 5, in order. Whole numbers, 1 or greater.
          </p>
          <div className="flex gap-2">
            {data.defaultWordCountTargets.map((v, i) => (
              <input
                key={i}
                id={`word-count-target-${i}`}
                aria-label={`Generation ${i + 1} word-count target`}
                aria-describedby="word-count-targets-hint"
                type="number"
                min={1}
                step={1}
                value={wordCountRaw[i] ?? String(v)}
                onChange={(e) => {
                  const nextRaw = [...wordCountRaw];
                  nextRaw[i] = e.target.value;
                  setWordCountRaw(nextRaw);
                }}
                onBlur={() => {
                  if (wordCountRaw[i] === null) return;
                  const next = [...data.defaultWordCountTargets] as typeof data.defaultWordCountTargets;
                  next[i] = clampPositiveInt(wordCountRaw[i]!, v);
                  update("defaultWordCountTargets", next);
                  const nextRaw = [...wordCountRaw];
                  nextRaw[i] = null;
                  setWordCountRaw(nextRaw);
                }}
                className={inputClass + " w-20"}
              />
            ))}
          </div>
        </fieldset>
        <Field
          label="Retry threshold"
          htmlFor="retry-threshold"
          hint="Retry once, automatically, if a generation misses its target by more than this fraction. Adjustable, not a hardcoded magic number."
        >
          <div className="flex items-center gap-2">
            <input
              id="retry-threshold"
              aria-describedby="retry-threshold-hint"
              type="number"
              min={0}
              max={100}
              step={1}
              value={retryThresholdRaw ?? String(Math.round(data.retryThresholdFraction * 100))}
              onChange={(e) => setRetryThresholdRaw(e.target.value)}
              onBlur={() => {
                if (retryThresholdRaw === null) return;
                const pct = Math.round(Number(retryThresholdRaw));
                const currentPct = Math.round(data.retryThresholdFraction * 100);
                const clamped = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : currentPct;
                update("retryThresholdFraction", clamped / 100);
                setRetryThresholdRaw(null);
              }}
              className={inputClass + " w-24"}
            />
            <span className="text-sm text-slate-500">%</span>
          </div>
        </Field>
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
