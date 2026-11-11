#!/usr/bin/env node
/**
 * Mock Ollama server for local development and end-to-end testing.
 *
 * Speaks the same wire protocol as Ollama (GET /api/tags, POST /api/show,
 * streaming POST /api/chat) and answers every request type the app makes:
 * notes, cheat sheet, flashcards, quiz, mind map, key terms and the tutor.
 * Answers are derived from the request and deliberately imitate local-model
 * quirks (un-escaped LaTeX, messy Mermaid) so the repair layer is exercised.
 *
 *   npm run mock:ai                          # listens on :11434
 *   MOCK_PORT=11500 npm run mock:ai
 *   MOCK_TOKEN_DELAY_MS=8 npm run mock:ai    # slower streaming, to watch progress
 *   MOCK_THINKING=1 npm run mock:ai          # behave like a "thinking" model (qwen3 etc.)
 *   MOCK_MAX_CTX=6000 npm run mock:ai        # refuse larger context windows with an out-of-memory error
 *   MOCK_FAIL=quiz npm run mock:ai           # always return garbage for one output type
 *
 * It also imitates how Ollama spends time and memory, and reports it at
 * GET /mock/stats (POST /mock/reset clears it):
 *   - a request with a different num_ctx than the loaded model forces a reload;
 *   - the start of a prompt that matches the previous prompt is served from the
 *     cache, so only the rest has to be read again.
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 11434);
const MODEL = process.env.MOCK_MODEL || "llama3.1:latest";
const TOKEN_DELAY_MS = Number(process.env.MOCK_TOKEN_DELAY_MS ?? 1);
const THINKING = process.env.MOCK_THINKING === "1";
const MAX_CTX = Number(process.env.MOCK_MAX_CTX || 0);
const FAIL = process.env.MOCK_FAIL || "";

const STOPWORDS = new Set(
  "about above after again against because before being below between could during other their there these those through under until where which while would should another without within across along among around every first second third really thing things going today lecture student students people little actually basically create requested material topic study".split(" "),
);

function concepts(text, n = 6) {
  const freq = new Map();
  for (const w of text.match(/\b[A-Za-z][a-z]{5,}\b/g) ?? []) {
    const key = w.toLowerCase();
    if (!STOPWORDS.has(key)) freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w[0].toUpperCase() + w.slice(1));
  const fallback = ["Entropy", "Equilibrium", "Momentum", "Energy", "Vectors", "Systems"];
  while (top.length < n) top.push(fallback[top.length]);
  return top;
}

/** Serialise like a sloppy local model: LaTeX backslashes are NOT doubled. */
const sloppy = (obj) => JSON.stringify(obj, null, 1).replace(/\\\\(?=[a-zA-Z])/g, "\\");

function answer(kind, subject, c) {
  switch (kind) {
    case "notes":
      return [
        `# ${subject}`,
        "",
        ...c.slice(0, 4).flatMap((name) => [
          `## ${name}`,
          `- **${name}**: The governing principle relating $\\alpha$ to $\\theta$ through $\\frac{d${name[0]}}{dt} = k \\cdot ${name[0]}$.`,
          `  - *Mechanics*: Integrating gives $${name[0]}(t) = ${name[0]}_0 e^{kt}$ and $\\nabla \\phi$ points uphill.`,
          `  - *Analogy*: Think of ${name.toLowerCase()} as water finding its level in connected vessels.`,
          `  - *Blind Spot*: Students forget that $\\rho \\neq 0$ is required, otherwise $\\frac{1}{\\rho}$ diverges.`,
          "",
        ]),
        "$$E = mc^2$$",
      ].join("\n");
    case "cheatsheet":
      return [
        "## Key ideas",
        ...c.map((x) => `- **${x}** links rate to state`),
        "## Formulas & rules",
        `- $\\frac{dx}{dt} = kx$ — growth when $k > 0$`,
        "## Must-know facts",
        `- ${c[0]} is conserved in closed systems`,
        "## Common mistakes",
        "- Mixing up rate and amount",
        "## Memory hooks",
        `- "${c[0].slice(0, 3)}-rate equals ${c[0].slice(0, 3)}-state"`,
      ].join("\n");
    case "flashcards":
      return sloppy({
        flashcards: c.map((name) => ({
          question: `What does **${name}** describe, and how is it written mathematically?`,
          answer: `It links rate to state: $\\frac{d${name[0]}}{dt} = k ${name[0]}$. Hint: "${name.slice(0, 3)}-rate equals ${name.slice(0, 3)}-state".`,
        })),
      });
    case "quiz":
      return sloppy({
        questions: c.slice(0, 5).map((name, i) => ({
          question: `If $k$ doubles in the ${name.toLowerCase()} model, what happens to the doubling time?`,
          options: ["A) It halves", "B) It doubles", "C) It stays the same", "D) It quadruples"],
          correctAnswer: ["A", "B", "C", "D"][i % 4],
          explanation: `Doubling time is $t_2 = \\frac{\\ln 2}{k}$, so the inverse relation decides it.`,
        })),
      });
    case "terms":
      return sloppy({ terms: c.map((name) => ({ term: name, definition: `The quantity that changes at rate $k \\cdot ${name[0]}$ in ${subject}.` })) });
    case "mindmap":
      return ["```mermaid", "mindmap", `  root((${subject.slice(0, 30)}))`, ...c.slice(0, 5).flatMap((x) => [`    ${x} (core)`, `      Formula $\\frac{a}{b}$`, "      Applications [real world]"]), "```"].join("\n");
    default:
      return "";
  }
}

function tutorReply(question, context) {
  const c = concepts(context, 3);
  return `Great question. In short: **${c[0]}** is about how a rate depends on the current state, written $\\frac{dx}{dt} = kx$.\n\n- Think of it like interest on savings: the more you have, the faster it grows.\n- Your notes connect it to **${c[1]}** and **${c[2]}**.\n\nYou asked: _${question.slice(0, 80)}_. Can you tell me what happens when $k < 0$?`;
}

function kindOf(prompt) {
  if (prompt.includes("study tutor")) return "tutor";
  if (prompt.includes("Markdown study notes")) return "notes";
  if (prompt.includes("one-page cheat sheet")) return "cheatsheet";
  if (prompt.includes('{"flashcards"')) return "flashcards";
  if (prompt.includes('{"questions"')) return "quiz";
  if (prompt.includes('{"terms"')) return "terms";
  if (prompt.includes("Mermaid mindmap code")) return "mindmap";
  return "unknown";
}

/* ---- Imitation of Ollama's model loading and prompt cache, for measuring ---- */
const sim = { loadedCtx: null, loads: 0, reloads: 0, lastPrompt: "", requests: [] };
function simulate(body, kind, prompt) {
  const ctx = body.options?.num_ctx ?? 0;
  let reload = false;
  if (sim.loadedCtx !== ctx) {
    reload = sim.loadedCtx !== null;
    if (reload) sim.reloads++;
    sim.loads++;
    sim.loadedCtx = ctx;
    sim.lastPrompt = ""; // a reload throws the cache away
  }
  let cached = 0;
  const prev = sim.lastPrompt;
  const max = Math.min(prev.length, prompt.length);
  while (cached < max && prev.charCodeAt(cached) === prompt.charCodeAt(cached)) cached++;
  sim.lastPrompt = prompt;
  sim.requests.push({ kind, ctx, promptChars: prompt.length, cachedChars: cached, numPredict: body.options?.num_predict ?? null, reload });
}
function simStats() {
  const r = sim.requests;
  const sum = (f) => r.reduce((s, x) => s + f(x), 0);
  return {
    requests: r.length,
    loads: sim.loads,
    reloads: sim.reloads,
    contextSizes: [...new Set(r.map((x) => x.ctx))],
    maxContext: Math.max(0, ...r.map((x) => x.ctx)),
    promptChars: sum((x) => x.promptChars),
    promptCharsReadAgain: sum((x) => x.promptChars - x.cachedChars),
    numPredictTotal: sum((x) => x.numPredict ?? 0),
    detail: r,
  };
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/api/tags") return json(res, 200, { models: [{ name: MODEL, model: MODEL }] });
  if (req.method === "GET" && url.pathname === "/api/version") return json(res, 200, { version: "0.0.0-mock" });
  if (req.method === "POST" && url.pathname === "/api/show") {
    return json(res, 200, { capabilities: THINKING ? ["completion", "tools", "thinking"] : ["completion", "tools"] });
  }
  if (req.method === "GET" && url.pathname === "/mock/stats") return json(res, 200, simStats());
  if (req.method === "POST" && url.pathname === "/mock/reset") {
    Object.assign(sim, { loadedCtx: null, loads: 0, reloads: 0, lastPrompt: "", requests: [] });
    return json(res, 200, { ok: true });
  }
  if (req.method !== "POST" || url.pathname !== "/api/chat") return json(res, 404, { error: "not found" });

  const body = JSON.parse(await readBody(req));
  const wanted = String(body.model);
  if (wanted !== MODEL && `${wanted}:latest` !== MODEL) return json(res, 404, { error: `model "${wanted}" not found, try pulling it first` });

  const numCtx = body.options?.num_ctx ?? 0;
  if (MAX_CTX && numCtx > MAX_CTX) {
    console.log(`[mock-ollama] refusing num_ctx=${numCtx} (limit ${MAX_CTX})`);
    return json(res, 500, { error: "model requires more system memory (5.2 GiB) than is available (3.1 GiB)" });
  }

  const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
  const users = (body.messages ?? []).filter((m) => m.role === "user");
  const user = users.at(-1)?.content ?? "";
  const prompt = (body.messages ?? []).map((m) => `<${m.role}>\n${m.content}`).join("\n");
  const kind = kindOf(system.includes("study tutor") ? system : prompt);
  simulate(body, kind, prompt);
  const topic = prompt.match(/TOPIC: (.+)/)?.[1] ?? prompt.match(/STUDENT'S FOCUS: (.+)/)?.[1];
  const material = prompt.split("<<<LECTURE_MATERIAL_START>>>")[1]?.split("<<<LECTURE_MATERIAL_END>>>")[0] ?? "";
  const c = concepts(`${topic ?? ""} ${material}`);
  const subject = (topic ?? c.slice(0, 2).join(" and ")).slice(0, 60);

  console.log(
    `[mock-ollama] ${kind} num_ctx=${numCtx} num_predict=${body.options?.num_predict} format=${typeof body.format === "object" ? "schema" : body.format ?? "none"} think=${body.think} chars=${system.length + user.length}`,
  );

  let content =
    kind === "tutor"
      ? tutorReply(user, system)
      : FAIL === kind
        ? "Sorry, I can't produce that right now."
        : answer(kind, subject, c);
  if (THINKING && body.think !== false) content = `<think>Planning the answer about ${subject}...</think>\n${content}`;

  if (body.stream === false) return json(res, 200, { model: wanted, message: { role: "assistant", content }, done: true, done_reason: "stop" });

  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  let aborted = false;
  res.on("close", () => (aborted = !res.writableFinished));
  for (let i = 0; i < content.length && !aborted; i += 10) {
    res.write(`${JSON.stringify({ model: wanted, message: { role: "assistant", content: content.slice(i, i + 10) }, done: false })}\n`);
    if (TOKEN_DELAY_MS > 0) await sleep(TOKEN_DELAY_MS);
  }
  if (aborted) return console.log("[mock-ollama] client aborted");
  res.end(`${JSON.stringify({ model: wanted, message: { role: "assistant", content: "" }, done: true, done_reason: "stop" })}\n`);
});

server.listen(PORT, () => console.log(`[mock-ollama] listening on http://localhost:${PORT} serving "${MODEL}"${THINKING ? " (thinking model)" : ""}`));
