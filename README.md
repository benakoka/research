# AI-Only Transmission Chain Pilot Tool

Internal pilot tool for *"Whose side is AI on?"* (Lawson et al., UCSB) — the
AI-only debugging phase of a cultural-transmission-chain study on gendered
attribution bias. Two independent modules, run separately:

- **Attribution** — rates each vignette twice per model (as-written and
  gender-flipped scale direction).
- **Rewriting** — runs each vignette through a 5-generation rewriting chain,
  per model, tracking word-count compliance.

The site holds no vignette data of its own — every run starts from an
`.xlsx` upload in the shape of `templates/vignette_upload_template.xlsx`.

## Stack

Next.js (App Router) + TypeScript, deployed to Vercel. Persistence via
Vercel KV (Upstash Redis under the hood — Vercel KV itself is deprecated in
favor of installing a Redis integration directly, but the REST API and env
vars are the same either way). OpenAI + Gemini calls happen server-side only.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `PASSWORD_HASH` | yes | Shared site password, hashed. Generate with `node scripts/hash-password.mjs "your password"` and paste the output. The plaintext password is never stored. |
| `SESSION_SECRET` | yes | Long random string used to sign the session cookie (e.g. `openssl rand -hex 32`). |
| `OPENAI_API_KEY` | yes, to use GPT | Server-side only, read directly from the environment — never stored in KV or sent to the client. |
| `GEMINI_API_KEY` | yes, to use Gemini | Same as above. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | production | From a Vercel KV / Upstash Redis integration. Without these, the app falls back to a local JSON file (`.data/kv-store.json`, gitignored) so `npm run dev` works out of the box — **never used in production**, since serverless functions don't share a durable filesystem across invocations. |
| `USE_CLAUDE_FOR_TESTING` | no | Test-mode only — see below. |
| `ANTHROPIC_API_KEY` | test mode only | Used instead of the OpenAI/Gemini keys when `USE_CLAUDE_FOR_TESTING=true`. |

### Test mode (no OpenAI/Gemini budget yet)

If you want to exercise the pipeline — upload, batch runs, retries, exports —
before real OpenAI/Gemini budget is available, set:

```
USE_CLAUDE_FOR_TESTING=true
ANTHROPIC_API_KEY=<your Anthropic console key>
```

With this on, both the "GPT" and "Gemini" slots route through Claude on that
one key instead. Type a real Claude model ID (e.g.
`claude-haiku-4-5-20251001` — cheapest current model, good for burning
through a small balance) into **both** model snapshot fields on the
Settings screen; the Settings page shows a banner while test mode is
active as a reminder. This is for pipeline testing only — Claude's
output isn't a substitute for the real GPT/Gemini data the study is about.
Delete any vignette sets/runs created in this mode once real keys are in,
then unset `USE_CLAUDE_FOR_TESTING` and set `OPENAI_API_KEY` /
`GEMINI_API_KEY` — no code changes needed either way.

API keys are operator-level secrets for this single-tenant tool (one shared
password, one operator managing both provider accounts) — they live in
Vercel env vars, not the Settings screen, so rotating a key never touches
the app's data store. The Settings screen shows whether each key is
currently configured (masked), but they're only changed via env vars.
Model snapshot strings are still a Settings-screen field, since those you'll
plausibly want to change per run — there's no hardcoded fallback for them
by design (see the build spec, §7).

## Local development

```bash
npm install
node scripts/hash-password.mjs "some-password"   # copy the printed value
```

Create `.env.local`:

```
PASSWORD_HASH=<value printed above>
SESSION_SECRET=<a long random string>
OPENAI_API_KEY=<your OpenAI key>
GEMINI_API_KEY=<your Gemini key>
```

```bash
npm run dev
```

Open http://localhost:3000, log in with the password you hashed, then set
model snapshot strings on the Settings screen before running either module.

## Deploying to Vercel

1. Push this repo to Vercel.
2. Add a Redis/KV integration (Storage tab → Redis) — it sets
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically.
3. Set `PASSWORD_HASH`, `SESSION_SECRET`, `OPENAI_API_KEY`, and
   `GEMINI_API_KEY` in the project's Environment Variables.
4. Deploy. Log in, then fill in model snapshots on Settings.

The app ships `robots.txt` (disallow-all) and a `noindex` meta tag as a
belt-and-suspenders alongside the password gate — it's not meant to be
publicly discoverable.

## Vignette input format

`templates/vignette_upload_template.xlsx` is the canonical input, with an
`Instructions` tab and a `Vignettes` data tab (header row 1, data from row
2, parsed by column header name). It has one illustrative example scenario
(not real data — see the script that generates it) rather than the real
18-scenario/36-row seed set, since that content wasn't included in the
files this app was built from. Regenerate the template (e.g. after adding a
column) with:

```bash
node scripts/build-vignette-template.mjs
```

Rows must come in `order_variant` A/B pairs. `domain`, `valence`, and
`order_variant` are dropdown-restricted; `vignette_id` is formula-generated
from the other columns — don't type it by hand.

## Notes on the build

- Rep count for Attribution defaults to 1 (each text × scale direction ×
  model runs once) — configurable in Settings, but nothing in the app
  assumes reps > 1. The wide-format Attribution export averages across reps
  if it's ever raised.
- Rewriting's automatic retry-on-miss threshold (default 25%) is a Settings
  constant, not a hardcoded value.
- There is no spending cap — Settings shows a running call-count / rough
  cost estimate (using $/1M-token pricing you enter there); manage budget
  limits directly in the OpenAI/Google billing dashboards.
- Batch processing for both modules works by the client repeatedly calling a
  `/process` endpoint that advances a small, rate-limit-friendly batch of
  pending work and returns — this keeps each serverless invocation short
  while still supporting 100+ call runs, live progress, and re-running a
  single failed cell/generation without restarting the batch.
