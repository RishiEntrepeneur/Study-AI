#!/usr/bin/env node
/**
 * Mock Ollama server for local development and end-to-end testing.
 *
 * Implements GET /api/tags, GET /api/version and streaming POST /api/chat with
 * the same NDJSON wire format as Ollama. The generated study suite is derived
 * from the submitted lecture text and deliberately mimics real llama3.1 quirks
 * (un-escaped LaTeX backslashes, messy Mermaid) so the repair layer is exercised.
 *
 *   npm run mock:ai                      # listens on :11434
 *   MOCK_PORT=11500 npm run mock:ai
 *   MOCK_TOKEN_DELAY_MS=5 npm run mock:ai   # slower streaming
 *   MOCK_BROKEN_FIRST=1 npm run mock:ai     # first answer is truncated JSON (tests retry)
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 11434);
const MODEL = process.env.MOCK_MODEL || "llama3.1:latest";
const TOKEN_DELAY_MS = Number(process.env.MOCK_TOKEN_DELAY_MS ?? 1);
let brokenFirst = process.env.MOCK_BROKEN_FIRST === "1";

const STOPWORDS = new Set(
  "about above after again against because before being below between could during other their there these those through under until where which while would should another without within across along among around every first second third really thing things going today lecture student students people little actually basically".split(" "),
);

function concepts(text, n = 6) {
  const freq = new Map();
  for (const w of text.match(/\b[A-Za-z][a-z]{6,}\b/g) ?? []) {
    const key = w.toLowerCase();
    if (!STOPWORDS.has(key)) freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w[0].toUpperCase() + w.slice(1));
  while (top.length < n) top.push(["Entropy", "Equilibrium", "Momentum", "Inertia", "Energy", "Vectors"][top.length]);
  return top;
}

function studySuite(lecture, segmentLabel, deep) {
  const c = concepts(lecture);
  const notes = [
    `# ${c[0]} and ${c[1]}${segmentLabel}`,
    "",
    ...c.slice(0, 4).flatMap((name, i) => [
      `## ${name}`,
      `- **${name}**: The governing principle that relates $\\alpha$ to $\\theta$ through $\\frac{d${name[0]}}{dt} = k \\cdot ${name[0]}$.`,
      `  - *Mechanics*: Integrating gives $$${name[0]}(t) = ${name[0]}_0 e^{kt}$$ and the gradient $\\nabla \\phi$ points toward steepest ascent.`,
      `  - *Analogy*: Think of ${name.toLowerCase()} as water finding its level in connected vessels.`,
      `  - *Blind Spot*: The lecture skipped why $\\rho \\neq 0$ is required — without it the ratio $\\frac{1}{\\rho}$ diverges.`,
      i === 0 && deep ? "  - *Derivation*: Starting from $\\Delta S \\geq 0$, separate variables and integrate both sides." : "",
    ]).filter(Boolean),
  ].join("\n");

  const flashcards = c.map((name) => ({
    question: `What does **${name}** describe, and how is it written mathematically?`,
    answer: `It links rate to state: $\\frac{d${name[0]}}{dt} = k ${name[0]}$. Memory hint: "${name.slice(0, 3)}-rate equals ${name.slice(0, 3)}-state".`,
  }));

  const quiz = c.slice(0, 6).map((name, i) => ({
    question: `If $k$ doubles in the ${name.toLowerCase()} model, what happens to the doubling time?`,
    options: ["A) It halves", "B) It doubles", "C) It stays the same", "D) It quadruples"],
    correctAnswer: ["A", "B", "C", "D"][i % 4],
    explanation: `Doubling time is $t_2 = \\frac{\\ln 2}{k}$, so the correct choice follows directly; the other options misread the inverse relation.`,
  }));

  const mindMapCode = [
    "```mermaid",
    "mindmap",
    `  root((${c[0]} Systems${segmentLabel}))`,
    ...c.slice(1, 5).flatMap((name) => [
      `    ${name} (core idea)`,
      `      Formula $\\frac{a}{b}$`,
      `      Applications [real world]`,
    ]),
    "```",
  ].join("\n");

  return { deepNotes: notes, flashcards, quiz, mindMapCode };
}

/** Serialise like a sloppy local model: LaTeX backslashes are NOT doubled. */
function sloppyJson(obj) {
  return JSON.stringify(obj, null, 1).replace(/\\\\(?=[a-zA-Z])/g, "\\");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/tags") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ models: [{ name: MODEL, model: MODEL, size: 4920753328 }] }));
  }
  if (req.method === "GET" && url.pathname === "/api/version") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ version: "0.0.0-mock" }));
  }
  if (req.method !== "POST" || url.pathname !== "/api/chat") {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "not found" }));
  }

  const body = JSON.parse(await readBody(req));
  const wanted = String(body.model);
  if (wanted !== MODEL && `${wanted}:latest` !== MODEL) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: `model "${wanted}" not found, try pulling it first` }));
  }

  const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
  const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
  const isSynthesis = system.includes("SYNTHESIS pass");
  const deep = system.includes("DEEP DIVE");
  const segment = user.match(/SEGMENT (\d+) OF (\d+)/);
  const lecture = user.split("<<<LECTURE_MATERIAL_START>>>")[1]?.split("<<<LECTURE_MATERIAL_END>>>")[0] ?? user;

  console.log(
    `[mock-ollama] chat model=${wanted} num_ctx=${body.options?.num_ctx} num_predict=${body.options?.num_predict} ` +
      `format=${typeof body.format === "object" ? "schema" : body.format} tier=${deep ? "deep_dive" : "standard"} ` +
      `${isSynthesis ? "synthesis" : segment ? `segment ${segment[1]}/${segment[2]}` : "single"} promptChars=${system.length + user.length}`,
  );

  let content;
  if (isSynthesis) {
    content = JSON.stringify({
      title: "Unified Systems Lecture",
      overview:
        "## The Big Picture\n- Each segment builds the same rate-state law $\\frac{dx}{dt} = kx$ in a new context.\n## How the Concepts Connect\n- Segment 1 defines the law\n  - Segment 2 applies it\n## Master Blind Spots\n- Stability requires $k < 0$.\n## Learning Roadmap\n1. Master the law\n2. Apply it",
    });
  } else {
    content = sloppyJson(studySuite(lecture, segment ? ` Part ${segment[1]}` : "", deep));
    if (brokenFirst) {
      brokenFirst = false;
      content = content.slice(0, Math.floor(content.length / 2)); // simulate a cut-off answer
    }
  }

  const stream = body.stream !== false;
  if (!stream) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ model: wanted, message: { role: "assistant", content }, done: true, done_reason: "stop" }));
  }

  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  let aborted = false;
  res.on("close", () => (aborted = !res.writableFinished));
  for (let i = 0; i < content.length && !aborted; i += 12) {
    res.write(`${JSON.stringify({ model: wanted, message: { role: "assistant", content: content.slice(i, i + 12) }, done: false })}\n`);
    if (TOKEN_DELAY_MS > 0) await sleep(TOKEN_DELAY_MS);
  }
  if (aborted) return console.log("[mock-ollama] client aborted generation");
  res.end(`${JSON.stringify({ model: wanted, message: { role: "assistant", content: "" }, done: true, done_reason: "stop", eval_count: Math.ceil(content.length / 4) })}\n`);
});

server.listen(PORT, () => console.log(`[mock-ollama] listening on http://localhost:${PORT} serving "${MODEL}"`));
