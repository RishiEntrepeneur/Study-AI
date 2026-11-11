# Superpower Study Suite

A private study space. Type what you want to learn (or bring lecture notes, a recording, a PDF or a Word file), pick what you want, and the app creates it with **your own AI model** running on your computer through Ollama. No API keys, no subscription, and nothing you study leaves your machine.

**What you can create (pick any combination):**

| Output | What it is |
| --- | --- |
| Notes | Textbook-style notes: definition, how it works, an analogy and the "blind spot" for every concept, with real math typesetting. Editable, and can be read aloud. |
| Cheat sheet | One page of key ideas, formulas, must-know facts and common mistakes. |
| Flashcards | Index cards you flip, plus **spaced repetition**: each card comes back right before you'd forget it. |
| Quiz | Multiple-choice questions with instant feedback, explanations and score history. |
| Mind map | A zoomable, pannable map of how the ideas connect. |
| Key terms | A searchable glossary. |

Plus: **folders** for each class, an **AI tutor** you can chat with about each project, **live lecture recording** (browser speech recognition), a **Review** page for all due flashcards, accounts with login, and light/dark themes.

---

## Run it (Windows)

You need [Node.js](https://nodejs.org) 20.9 or newer and [Ollama](https://ollama.com).

In PowerShell, inside the project folder:

```powershell
npm.cmd install
copy .env.example .env.local
ollama list
```

If `ollama list` shows a model other than `llama3.1` (for example `qwen3.5:4b`), open `.env.local` in Notepad and set `AI_MODEL_NAME` to that name. Or download llama3.1 with `ollama pull llama3.1`.

Then build and start the app:

```powershell
npm.cmd run build
npm.cmd start
```

Open **http://localhost:3000**, create an account, and start studying. Keep the PowerShell window open while you use the app.

> PowerShell blocks `npm` by default ("running scripts is disabled"). Using `npm.cmd` avoids that. To fix it permanently: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### No AI model yet?

Run a pretend AI in a second window to try the app (it gives placeholder answers):

```powershell
npm.cmd run mock:ai
```

### Updating

```powershell
git pull
npm.cmd install
npm.cmd run build
npm.cmd start
```

### If it's slow, or your laptop struggles

The app tunes itself to your computer: on an 8 GB laptop it uses a small, fixed amount of AI memory and lets Ollama free it 5 minutes after you
stop. **Settings → AI speed** shows what it picked. To go faster still:

- **Make fewer things at once.** Notes and flashcards first; add the rest later from the project page. Keep the depth on *Standard*.
- **Read while it writes.** Notes appear as they're written, so you can start before they're finished.
- **Close big programs** (games, video, lots of browser tabs) while the AI writes. The AI needs that memory.
- **Use a smaller model.** About twice as fast, a little less detailed:

  ```powershell
  ollama pull qwen3.5:2b
  ```

  Then set `AI_MODEL_NAME=qwen3.5:2b` in `.env.local`, and run `npm.cmd run build` and `npm.cmd start` again.
- **Halve Ollama's working memory** (optional). Run these once in PowerShell, then quit Ollama (right-click its icon by the clock → Quit) and open it again:

  ```powershell
  setx OLLAMA_FLASH_ATTENTION 1
  ```

  ```powershell
  setx OLLAMA_KV_CACHE_TYPE q8_0
  ```

If the AI runs out of memory, the app lowers its memory setting by itself and tries again.

Your data (accounts, projects, flashcard progress) lives in the `data` folder and is kept across updates.

---

## How it works

```
Browser                                Next.js server                               Your computer
───────                                ──────────────                               ─────────────
Create project  ── POST /api/projects ─▶  save project + materials (SQLite file)
(topic and/or material,                   queue one job per chosen output
 chosen outputs)                          background engine: a project's outputs ──▶  Ollama /api/chat
                                            are made together, notes first          (one fixed context
                                            • topic-only or from material            size: no reloads)
Project pages  ◀── poll status ─────────   • long material → parts sized to memory;   (streams tokens)
                                              the rest is made from the notes
(live progress,                             • repairs messy JSON / LaTeX / Mermaid
 retry, cancel)                             • out of memory → smaller context, then
                                              split the material and try again
Tutor chat     ── POST …/chat (stream) ─▶  retrieves the most relevant passages ──▶ Ollama
```

- **Database:** SQLite compiled to WebAssembly (sql.js) with Drizzle ORM. No native modules, so `npm install` works the same on Windows, macOS and Linux. Saved to `data/study-suite.db`.
- **Accounts:** email + password (scrypt hashing), database sessions in an httpOnly cookie. Every query is scoped to the signed-in user.
- **Thinking models** (qwen3, deepseek-r1 and similar) are detected via `/api/show`; thinking is switched off and any `<think>` text is removed.
- **Errors are explained in plain language**: AI offline (with automatic retries), model not installed, out of memory, unreadable answer, timeout.

### Key files

| Path | Purpose |
| --- | --- |
| `src/lib/ai/engine.ts` | Background job queue; resumes unfinished work after a restart |
| `src/lib/ai/generate.ts` | Makes a project's outputs together (material read once and cached), block sizing, retries, memory fallback |
| `src/lib/ai/config.ts` | Settings, and the automatic memory profile for this computer |
| `src/lib/ai/prompts.ts` | Academic Core prompt, Deep Dive protocol, one contract per output type (the shared part comes first so it can be cached) |
| `src/lib/ai/ollama.ts` | Streaming Ollama client |
| `src/lib/ai/tutor.ts`, `retrieval.ts` | Tutor prompt and BM25 passage retrieval |
| `src/lib/db/` | Schema and database (migrations in `drizzle/`) |
| `src/lib/data/` | Data access layer (all user-scoped) |
| `src/lib/srs.ts` | Spaced-repetition scheduling |
| `src/app/(app)/` | Signed-in pages: dashboard, folders, projects, review, settings |
| `scripts/mock-ollama.mjs` | Fake Ollama for development and tests |

### API

| Route | Purpose |
| --- | --- |
| `POST /api/projects` | `{ topic?, title?, tier?, folderId?, materials?: [{kind, name, content}], outputs: [...] }` → `{ id }` |
| `GET /api/projects/:id/status` | Status and live progress of every output |
| `POST /api/projects/:id/generate` | `{ outputs: [...] }` create or regenerate |
| `POST /api/projects/:id/materials` | `{ materials: [...] }` add material |
| `POST /api/projects/:id/chat` | `{ message }` → NDJSON stream of `delta` / `done` / `error` events |
| `GET /api/health` | AI server status (never exposes its address) |

All routes except `/api/health` require a signed-in session.

## Development

```bash
npm run dev          # http://localhost:3000
npm test             # unit tests (vitest)
npm run typecheck
npm run lint
npm run mock:ai      # fake Ollama; MOCK_THINKING=1, MOCK_MAX_CTX=6000, MOCK_FAIL=quiz simulate problems
npx drizzle-kit generate   # after changing src/lib/db/schema.ts
```

Settings are documented in `.env.example`.
