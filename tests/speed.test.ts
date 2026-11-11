/**
 * Speed and memory on a laptop: the model must never be reloaded between
 * requests, material must be read as few times as possible, and every prompt
 * must fit the one context size in use. Runs against the pretend AI server,
 * which imitates Ollama's model loading and prompt cache.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutputContent, OutputType } from "@/lib/types";

const PORT = 11700 + Math.floor(Math.random() * 200);
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "speed-db-"));
process.env.PRIVATE_AI_URL = `http://127.0.0.1:${PORT}`;
process.env.AI_MODEL_NAME = "llama3.1";
process.env.AI_CONTEXT_SIZE = "6144"; // the "light" setting used on 8 GB laptops

const { getAIConfig, pickMemoryMode, activeContextSize } = await import("@/lib/ai/config");
const { generateBatch, wordsPerBlock, OUTPUT_ORDER } = await import("@/lib/ai/generate");
const { buildSharedSystem, buildTaskPrompt } = await import("@/lib/ai/prompts");
const { buildTutorMessages } = await import("@/lib/ai/tutor");

let mock: ChildProcess;
const MOCK = `http://127.0.0.1:${PORT}`;

beforeAll(async () => {
  mock = spawn(process.execPath, ["scripts/mock-ollama.mjs"], { env: { ...process.env, MOCK_PORT: String(PORT), MOCK_TOKEN_DELAY_MS: "0" }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((resolve, reject) => {
    mock.stdout!.on("data", (d: Buffer) => d.toString().includes("listening") && resolve());
    mock.on("exit", () => reject(new Error("mock AI server exited")));
  });
});
afterAll(() => {
  mock?.kill();
});
beforeEach(async () => {
  await fetch(`${MOCK}/mock/reset`, { method: "POST" });
});

interface Stats {
  requests: number;
  reloads: number;
  contextSizes: number[];
  promptChars: number;
  promptCharsReadAgain: number;
  detail: Array<{ kind: string; ctx: number; promptChars: number; cachedChars: number; numPredict: number }>;
}
const stats = async () => (await (await fetch(`${MOCK}/mock/stats`)).json()) as Stats;

function lecture(words: number): string {
  const vocab = "entropy equilibrium temperature pressure volume molecules energy heat work system reversible process cycle engine efficiency reservoir microstates probability gas expansion compression enthalpy reaction phase transition kinetic theory diffusion conduction radiation".split(" ");
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(vocab[(i * 7 + Math.floor(i / 13)) % vocab.length] + (i % 15 === 14 ? "." : ""));
  return out.join(" ").replace(/(\. )/g, (m, _p, off) => (off % 600 < 3 ? ".\n\n" : m));
}

async function run(types: OutputType[], materialText: string, abortType?: OutputType) {
  const results = new Map<OutputType, OutputContent | string>();
  const controllers = new Map(types.map((t) => [t, new AbortController()]));
  if (abortType) controllers.get(abortType)!.abort();
  await generateBatch({
    cfg: getAIConfig(),
    tier: "standard",
    title: "Thermodynamics",
    topic: materialText ? "" : "Thermodynamics",
    materialText,
    items: types.map((type) => ({
      type,
      signal: controllers.get(type)!.signal,
      onProgress: () => {},
      onDone: async (c) => void results.set(type, c),
      onFailed: async (e) => void results.set(type, e instanceof Error ? `failed: ${e.name}` : "failed"),
    })),
  });
  return results;
}

describe("memory settings", () => {
  it("picks small settings for small computers", () => {
    expect(pickMemoryMode(7.8, true)).toBe("light");
    expect(pickMemoryMode(15.6, true)).toBe("balanced");
    expect(pickMemoryMode(31, true)).toBe("roomy");
    expect(pickMemoryMode(7.8, false)).toBe("balanced"); // AI on another machine
    expect(getAIConfig().contextSize).toBe(6144);
  });
});

describe("prompts", () => {
  it("share one prefix for every output made from the same source", () => {
    const source = { kind: "material" as const, topic: "", title: "T", text: "Some lecture text." };
    const systems = new Set(OUTPUT_ORDER.map(() => buildSharedSystem("standard", source)));
    expect(systems.size).toBe(1);
    const tasks = new Set(OUTPUT_ORDER.map((t) => buildTaskPrompt(t, "standard")));
    expect(tasks.size).toBe(OUTPUT_ORDER.length);
  });

  it("ask for less per part when a long lecture is split", () => {
    expect(buildTaskPrompt("flashcards", "standard")).toContain("10 to 12 cards");
    expect(buildTaskPrompt("flashcards", "standard", 4)).toContain("about 3 cards");
    expect(buildTaskPrompt("notes", "standard")).toContain("600 to 900 words");
  });
});

describe("making a whole project", () => {
  it("topic only: one model load for every output, all six finished", async () => {
    const results = await run([...OUTPUT_ORDER], "");
    for (const t of OUTPUT_ORDER) expect(typeof results.get(t), t).toBe("object");
    const s = await stats();
    expect(s.requests).toBe(6);
    expect(s.reloads).toBe(0);
    expect(s.contextSizes).toEqual([6144]);
    // Everything but the first request reuses the cached instructions + topic.
    expect(s.detail.slice(1).every((d) => d.cachedChars > 1000)).toBe(true);
  });

  it("long lecture: read once for notes, then everything else is made from the notes", async () => {
    const text = lecture(12_000);
    const results = await run([...OUTPUT_ORDER], text);
    for (const t of OUTPUT_ORDER) expect(typeof results.get(t), t).toBe("object");
    const s = await stats();
    expect(s.reloads).toBe(0);
    expect(s.contextSizes).toEqual([6144]);
    // Every prompt fits the context with room for the answer.
    for (const d of s.detail) expect(Math.ceil(d.promptChars / 3.2) + d.numPredict, d.kind).toBeLessThanOrEqual(6144);
    // The lecture itself is read about once, not once per output.
    const notesCalls = s.detail.filter((d) => d.kind === "notes");
    const lectureReads = notesCalls.reduce((sum, d) => sum + d.promptChars - d.cachedChars, 0);
    expect(lectureReads).toBeLessThan(text.length * 1.4);
    expect(s.promptCharsReadAgain).toBeLessThan(text.length * 3);
  });

  it("short material: every output reuses the cached material", async () => {
    const text = lecture(900);
    await run(["notes", "flashcards", "quiz"], text);
    const s = await stats();
    expect(s.requests).toBe(3);
    expect(s.detail[1].cachedChars).toBeGreaterThan(text.length);
    expect(s.detail[2].cachedChars).toBeGreaterThan(text.length);
  });

  it("a stopped output is skipped and the rest still finish", async () => {
    const results = await run(["notes", "flashcards", "quiz"], "", "flashcards");
    expect(results.get("flashcards")).toMatch(/failed/);
    expect(typeof results.get("notes")).toBe("object");
    expect(typeof results.get("quiz")).toBe("object");
    expect((await stats()).requests).toBe(2);
  });

  it("blocks are sized from the context, and never above the original 8,000 words", () => {
    const small = wordsPerBlock(getAIConfig(), "standard", [...OUTPUT_ORDER], lecture(1000));
    expect(small.size).toBeGreaterThan(500);
    expect(small.size).toBeLessThan(3000);
    expect(activeContextSize(getAIConfig())).toBe(6144);
  });
});

describe("tutor", () => {
  it("fits its prompt into the budget and never starts the history with an answer", () => {
    const long = "x ".repeat(3000);
    const messages = buildTutorMessages(
      {
        title: "T",
        topic: "",
        materials: [{ name: "Lecture", content: lecture(5000) }],
        history: Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: long })),
        question: "Why?",
      },
      2000,
    );
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    expect(chars).toBeLessThanOrEqual(2000 * 3.2 + 200);
    expect(messages[1].role === "assistant").toBe(false);
    expect(messages.at(-1)!.content).toBe("Why?");
  });
});

describe("block sizes", () => {
  it("material just over one block is split in two, and each block fits", async () => {
    const { trigger } = wordsPerBlock(getAIConfig(), "standard", ["notes", "flashcards"], lecture(2000));
    await fetch(`${MOCK}/mock/reset`, { method: "POST" });
    const results = await run(["notes", "flashcards"], lecture(trigger + 50));
    expect(typeof results.get("notes")).toBe("object");
    const s = await stats();
    // Split rather than sent as one request that would overflow (paragraph boundaries can make it 3 parts).
    expect(s.detail.filter((d) => d.kind === "notes").length).toBeGreaterThanOrEqual(2);
    for (const d of s.detail) expect(Math.ceil(d.promptChars / 3.2) + d.numPredict, d.kind).toBeLessThanOrEqual(6144);
  });
});

describe("running out of memory", () => {
  it("lowers the context once, then everything finishes at the smaller size", async () => {
    const port = PORT + 300;
    const tight = spawn(process.execPath, ["scripts/mock-ollama.mjs"], {
      env: { ...process.env, MOCK_PORT: String(port), MOCK_TOKEN_DELAY_MS: "0", MOCK_MAX_CTX: "5000" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    try {
      await new Promise<void>((resolve) => tight.stdout!.on("data", (d: Buffer) => d.toString().includes("listening") && resolve()));
      const cfg = { ...getAIConfig(), baseUrl: `http://127.0.0.1:${port}` };
      const results = new Map<OutputType, unknown>();
      await generateBatch({
        cfg,
        tier: "standard",
        title: "Thermodynamics",
        topic: "",
        materialText: lecture(1500),
        items: (["notes", "flashcards"] as OutputType[]).map((type) => ({
          type,
          signal: new AbortController().signal,
          onProgress: () => {},
          onDone: async (c) => void results.set(type, c),
          onFailed: async (e) => void results.set(type, e),
        })),
      });
      expect(typeof results.get("notes")).toBe("object");
      expect(typeof results.get("flashcards")).toBe("object");
      expect((results.get("notes") as { type?: string }).type).toBe("notes");
      expect(activeContextSize(cfg)).toBeLessThan(5000);
      const s = (await (await fetch(`http://127.0.0.1:${port}/mock/stats`)).json()) as Stats;
      expect(s.contextSizes).toEqual([activeContextSize(cfg)]); // after the shrink, one size only
    } finally {
      tight.kill();
    }
  });
});
