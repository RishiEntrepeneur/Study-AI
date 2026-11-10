# Superpower Study Suite

A dark-mode Next.js dashboard that turns any lecture (transcripts, notes, PDFs, DOCX) into a **Master Study Suite**:

| Tab | What students get |
| --- | --- |
| **Deep Notes** | Exhaustive Markdown notes (concept → *Mechanics* / *Analogy* / *Blind Spot*) with KaTeX-typeset LaTeX and a live outline |
| **Flashcards** | Full-screen 3D click-to-flip cards with Back/Next, shuffle, focus mode and keyboard shortcuts |
| **Interactive Quiz** | One question at a time, instant emerald/crimson feedback, explanation reveal and a live scoreboard |
| **Visual Mind Map** | Mermaid.js mind map on a pan/zoom canvas with fit-to-view, focus mode, SVG export and source view |

Students never need an API key. All inference runs on **your own private AI server** (e.g. Ollama + `llama3.1`), configured through server-side environment variables only.

---

## Quick start

```bash
cp .env.example .env.local      # point PRIVATE_AI_URL / AI_MODEL_NAME at your server
npm install
npm run dev                     # http://localhost:3000
```

### Running against a real Ollama server

```bash
ollama pull llama3.1
ollama serve                    # listens on http://localhost:11434 by default
```

If Ollama runs on another machine, start it with `OLLAMA_HOST=0.0.0.0` and set `PRIVATE_AI_URL=http://<gpu-host>:11434`. Keep that port private to your network. If you put Ollama behind an authenticating reverse proxy, set `PRIVATE_AI_API_KEY` and it is sent as a Bearer token.

### Trying it without a GPU (mock AI server)

```bash
npm run mock:ai                                        # fake Ollama on :11434
MOCK_TOKEN_DELAY_MS=8 npm run mock:ai                  # slower streaming, to watch the progress steps
MOCK_PORT=11500 npm run mock:ai                        # other port (then set PRIVATE_AI_URL)
```

The mock speaks the real Ollama wire protocol (`/api/tags`, streaming NDJSON `/api/chat`) and deliberately emits llama-style mistakes (un-escaped LaTeX, messy Mermaid), so it exercises the repair layer too.

---

## Architecture

```
Browser (Dashboard.tsx)                       Next.js server                          Private AI
──────────────────────                        ──────────────                          ──────────
drop / paste → text extraction                POST /api/generate                      Ollama /api/chat
(PDF, DOCX, SRT/VTT cleanup, HTML)  ───────▶  1. rate limit + validate                (llama3.1)
                                              2. preflight GET /api/tags ──▶ 503 if down
progress steps  ◀── NDJSON events ──────────  3. chunk > 15,000 words into ≤ 8,000-word
                                                 chronological blocks
                                              4. per block: system prompt (Academic Core
                                                 + tier) + JSON-schema output ─────────▶  streams tokens
                                                 rolling context of concepts covered
                                              5. repair & validate JSON, retry once
                                              6. synthesis pass + deterministic merge
deepNotes / flashcards / quiz /   ◀────────── 7. result event
mindMapCode → separate React states
```

### Key files

| Path | Purpose |
| --- | --- |
| `src/app/api/generate/route.ts` | The pipeline endpoint: validation, rate limit, 503 preflight, JSON or NDJSON streaming |
| `src/app/api/health/route.ts` | Status probe used by the header pill (never exposes the server URL) |
| `src/lib/ai/prompts.ts` | Academic Core system prompt (verbatim), Deep Dive injection, JSON schema, synthesis prompt |
| `src/lib/ai/pipeline.ts` | Chunk → generate with rolling context → synthesise → merge |
| `src/lib/ai/ollama.ts` | Streaming Ollama client (structured outputs with JSON-mode fallback, long-job timeouts) |
| `src/lib/ai/normalize.ts` | JSON extraction, LaTeX-escape repair, schema coercion |
| `src/lib/text/chunking.ts` | Boundary-aware, balanced, lossless word chunker |
| `src/lib/mindmap.ts` | Mermaid mindmap sanitiser / merger / notes-derived fallback |
| `scripts/vendor-mermaid.mjs` | Copies Mermaid's prebuilt browser file to `public/vendor/` (runs on install, dev and build) so the bundler never has to process it |
| `src/app/components/Dashboard.tsx` | Main UI: drop zone, tier toggle, processing steps, tabs |
| `src/app/components/tabs/*` | Deep Notes, Flashcards, Quiz, Mind Map |

### API contract

`POST /api/generate`

```json
{ "sourceText": "string", "contextTier": "standard" | "deep_dive" }
```

Success (`200`) returns the AI schema plus metadata:

```json
{
  "deepNotes": "markdown with $LaTeX$",
  "flashcards": [{ "question": "…", "answer": "…" }],
  "quiz": [{ "question": "…", "options": ["…","…","…","…"], "correctAnswer": "A", "explanation": "…" }],
  "mindMapCode": "mindmap\n  root((Topic))\n    …",
  "meta": { "title": "…", "model": "llama3.1", "tier": "deep_dive", "wordCount": 21280, "segments": 3, "durationMs": 81234, "generatedAt": "…" }
}
```

Send `Accept: application/x-ndjson` to receive progress events instead (`plan`, `segment_start`, `segment_progress`, `segment_done`, `synthesis_start`, then `result` or `error`), one JSON object per line.

| Status | When |
| --- | --- |
| `400` | Invalid JSON, empty `sourceText`, bad `contextTier`, fewer than 20 words |
| `413` | Body > 8 MB or more than `MAX_SOURCE_WORDS` words |
| `429` | Per-IP rate limit exceeded (`Retry-After` header set) |
| `502` | AI server returned an error or unusable output after a retry |
| `503` | AI server unreachable / busy / model not pulled: `{"error": "Our private AI server is warming up. Please give it a few moments!"}` |
| `504` | A single model call exceeded `AI_REQUEST_TIMEOUT_MS` |

### How long lectures are handled

* ≤ 15,000 words: a single pass.
* \> 15,000 words: split into chronological blocks of **at most 8,000 words**, preferring paragraph → line → sentence boundaries (hard word splits only for unpunctuated captions). Block sizes are balanced so the last block is never a tiny fragment, and every word is sent exactly once.
* Each block is processed in order with a rolling list of concepts already taught, so later blocks build on earlier ones instead of repeating them.
* A small synthesis call links the blocks ("Master Synthesis" section and overall title); the per-block notes, cards, quizzes and mind maps are then merged deterministically, so no content is dropped even if synthesis fails.
* Ollama's default context window is only a few thousand tokens and would silently truncate long prompts, so `num_ctx` is sized per request (prompt + output budget), never below `AI_NUM_CTX`.

### Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PRIVATE_AI_URL` | `http://localhost:11434` | Base URL of the Ollama server |
| `AI_MODEL_NAME` | `llama3.1` | Must be pulled on the server |
| `PRIVATE_AI_API_KEY` | – | Optional Bearer token for a proxy in front of Ollama |
| `AI_NUM_CTX` | `32768` | Minimum context window requested |
| `AI_NUM_PREDICT` | `8192` | Max generated tokens per call |
| `AI_TEMPERATURE` | `0.3` | |
| `AI_KEEP_ALIVE` | `30m` | How long Ollama keeps the model loaded |
| `AI_REQUEST_TIMEOUT_MS` | `900000` | Per-call ceiling (CPU-only servers are slow) |
| `MAX_SOURCE_WORDS` | `120000` | Largest accepted input |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `20` / `3600000` | Per-IP limit; `0` disables. In-memory, per process |

None of these use the `NEXT_PUBLIC_` prefix, so they never reach the browser.

---

## Scripts

```bash
npm run dev        # development server
npm run build      # production build
npm start          # serve the production build
npm test           # unit tests (chunking, JSON/LaTeX repair, quiz coercion, mind maps)
npm run lint
npm run typecheck
npm run mock:ai    # mock Ollama server
```

## Deployment notes

* Self-host next to (or on the same private network as) the AI server: `npm run build && npm start`, behind a reverse proxy. Disable response buffering for `/api/generate` (the route already sends `X-Accel-Buffering: no` and heartbeats every 15 s).
* Serverless hosts cap request duration (`maxDuration` is set to 300 s) and usually can't reach a private GPU box, so they are a poor fit for long lectures.
* The rate limiter is in-memory; with several replicas, rate-limit at the proxy instead.
* Mermaid is served from `public/vendor/mermaid.min.js` instead of being bundled. Bundling it needed over 2 GB of memory and crashed builds on smaller machines; the file is regenerated automatically and is git-ignored.
* Generated suites are cached only in the student's own browser (`localStorage`) so a refresh doesn't lose work.
