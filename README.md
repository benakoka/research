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

Next.js (App Router) + TypeScript, deployed to Vercel. **No database of any
kind** — there's nothing to provision, and nothing costs money beyond the
OpenAI/Gemini API usage itself. Settings, the uploaded vignette set, and
in-progress runs all live in the browser's `localStorage`; the server is
just Next.js API routes that call OpenAI/Gemini and hand results straight
back (see "Where data lives," below). OpenAI + Gemini calls happen
server-side only — the browser never sees an API key.

## Where data lives

Nothing here is written to a server database, on purpose — you download
the output when a run is done, and that download is the only durable copy.
Concretely:

- **Settings** (model snapshots, prompt templates, word-count targets,
  retry threshold) live in this browser's `localStorage`.
- **The uploaded vignette set** and **in-progress runs** (Attribution
  cells, Rewriting chains) also live in `localStorage`, so a page refresh
  or closed tab doesn't lose your place mid-run.
- **API routes are stateless transforms**: parse this file and hand back
  rows; call the model for these cells and hand back results; format this
  data as a CSV/XLSX. Nothing persists between requests server-side.

The practical implications: everything is scoped to one browser on one
machine (no "past runs" list, no syncing across devices), and clearing this
browser's site data resets everything to defaults. Export a run before
starting a new one or clearing your browser — starting a new run replaces
the previous one in `localStorage`.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `PASSWORD_HASH` | yes | Shared site password, hashed. Generate with `node scripts/hash-password.mjs "your password"` and paste the output. The plaintext password is never stored. |
| `SESSION_SECRET` | yes | Long random string used to sign the session cookie (e.g. `openssl rand -hex 32`). Sessions last 12 hours and there's no server-side session store, so there's no way to revoke one specific token early — but rotating this value and redeploying invalidates *every* outstanding session at once (their HMAC signatures stop verifying), which is the emergency kill switch if a cookie is ever suspected leaked. |
| `OPENAI_API_KEY` | yes, to use GPT | Server-side only, read directly from the environment — never stored anywhere, never sent to the client. |
| `GEMINI_API_KEY` | yes, to use Gemini | Same as above. |
| `USE_CLAUDE_FOR_TESTING` | no | Test-mode only — see below. |
| `ANTHROPIC_API_KEY` | test mode only | Used instead of the OpenAI/Gemini keys when `USE_CLAUDE_FOR_TESTING=true`. |

That's the complete list — no `KV_REST_API_URL`/`KV_REST_API_TOKEN`, no
database connection string, nothing to provision on Vercel beyond the
project itself.

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
Clear the test run from the Attribution/Rewriting page once real keys are
in, then unset `USE_CLAUDE_FOR_TESTING` and set `OPENAI_API_KEY` /
`GEMINI_API_KEY` — no code changes needed either way.

API keys are operator-level secrets (one shared password, one operator
managing both provider accounts) — they live in Vercel env vars, not
`localStorage`, so rotating a key never touches anything in the browser.
The Settings screen shows whether each key is currently configured
(masked), but they're only changed via env vars. Model snapshot strings are
a Settings-screen field, since those you'll plausibly want to change per
run — there's no hardcoded fallback for them by design (see the build
spec, §7).

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
2. Set `PASSWORD_HASH`, `SESSION_SECRET`, `OPENAI_API_KEY`, and
   `GEMINI_API_KEY` in the project's Environment Variables.
3. Deploy. Log in, then fill in model snapshots on Settings.

No Storage integration, no database — that's the whole setup.

The app ships `robots.txt` (disallow-all) and a `noindex` meta tag as a
belt-and-suspenders alongside the password gate — it's not meant to be
publicly discoverable.

## Vignette input format

The canonical input has an `Instructions` tab and a `Vignettes` data tab
(header row 1, data from row 2, parsed by column header name). It has one
illustrative example scenario (not real data — see the script that
generates it) rather than the real 18-scenario/36-row seed set, since that
content wasn't included in the files this app was built from.

It's shipped from two places in the repo, kept identical by
`scripts/build-vignette-template.mjs`:

- `templates/vignette_upload_template.xlsx` — source of truth, read
  server-side by the `/template` preview page.
- `public/vignette_upload_template.xlsx` — the same file, served
  statically so the app can offer it as a direct download.

The app itself surfaces both: every Attribution/Rewriting page has
"Download blank template" and "View template" links (the latter opens
`/template`, a read-only in-browser preview of both tabs — no upload
needed just to see the format). Regenerate both copies (e.g. after adding
a column) with:

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
- Rewriting's automatic retry-on-miss threshold (default 10%) is a Settings
  constant, not a hardcoded value.
- There is no spending cap or cost tracking in the app — manage budget
  limits directly in the OpenAI/Google billing dashboards.
- Batch processing for both modules works by the client (which holds the
  run's cells/chains in React state + localStorage) repeatedly calling a
  stateless `/process` endpoint with the next small batch of pending work,
  merging the results back into local state, and looping until done. This
  keeps each serverless invocation short while still supporting 100+ call
  runs, live progress, and re-running a single failed cell/generation
  without restarting the batch — all without a server-side store.
