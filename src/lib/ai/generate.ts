import "server-only";

import type { ContextTier, Flashcard, GenerationProgress, KeyTerm, OutputContent, OutputType, QuizQuestion } from "../types";
import { CHUNK_SIZE_WORDS, CHUNK_TRIGGER_WORDS, chunkText, countWords } from "../text/chunking";
import { mergeMindmaps, parseMindmap, sanitizeMindmap } from "../mindmap";
import { activeContextSize, estimateTokens, shrinkContextSize, type AIConfig } from "./config";
import { describeAIError } from "./errors";
import { AIMemoryError, chat } from "./ollama";
import { buildSharedSystem, buildTaskPrompt, OUTPUT_SCHEMAS, predictBudget, type PromptSource } from "./prompts";
import {
  cleanMarkdownOutput,
  ModelOutputError,
  normalizeFlashcards,
  normalizeQuiz,
  normalizeTerms,
  parseModelJson,
  stripThinking,
} from "./normalize";

/**
 * Making study outputs with a local model, as fast as a laptop allows:
 *
 * - Every request uses the same context size, so Ollama never reloads the model.
 * - All the outputs a student asked for are made together. Each block of
 *   material is read once and every output is written from it in turn: the
 *   material sits at the start of the prompt, which the model keeps cached.
 * - Notes come first. For long material, the other outputs are then made from
 *   the notes, which are far shorter than the material itself.
 */

/** Order in which outputs are made: notes first, so the rest can build on them. */
export const OUTPUT_ORDER: OutputType[] = ["notes", "cheatsheet", "flashcards", "quiz", "terms", "mindmap"];

export interface BatchItem {
  type: OutputType;
  /** Aborted when the student stops this one output. */
  signal: AbortSignal;
  onProgress: (p: GenerationProgress) => void;
  onDone: (content: OutputContent) => Promise<void>;
  onFailed: (err: unknown) => Promise<void>;
}

export interface BatchInput {
  cfg: AIConfig;
  tier: ContextTier;
  title: string;
  topic: string;
  /** All materials joined; empty string for topic-only projects. */
  materialText: string;
  /** Notes made earlier, if any. */
  existingNotes?: string;
  items: BatchItem[];
}

type Part =
  | { kind: "markdown"; value: string }
  | { kind: "cards"; value: Flashcard[] }
  | { kind: "questions"; value: QuizQuestion[] }
  | { kind: "terms"; value: KeyTerm[] }
  | { kind: "mindmap"; value: string };

const MIN_SPLIT_WORDS = 250;
const MIN_ANSWER_TOKENS = 384;
const TRANSIENT_RETRY_DELAYS_MS = [5_000, 15_000];

/** The prompt doesn't leave enough room for an answer: the block must be split. */
class NoRoomError extends Error {
  constructor() {
    super("The material block is too large for the AI's memory setting.");
    this.name = "NoRoomError";
  }
}

function parse(type: OutputType, raw: string, title: string): Part {
  switch (type) {
    case "notes":
    case "cheatsheet": {
      const md = cleanMarkdownOutput(raw);
      if (md.replace(/\s+/g, " ").length < 80) throw new ModelOutputError("The answer was too short to be useful.");
      return { kind: "markdown", value: md };
    }
    case "mindmap": {
      const code = sanitizeMindmap(stripThinking(raw), title);
      const tree = code ? parseMindmap(code) : null;
      if (!code || !tree || tree.children.length === 0) throw new ModelOutputError("The mind map could not be read.");
      return { kind: "mindmap", value: code };
    }
    case "flashcards": {
      const parsed = parseModelJson(raw) as Record<string, unknown>;
      const cards = normalizeFlashcards(parsed.flashcards ?? parsed.cards ?? parsed);
      if (!cards.length) throw new ModelOutputError("No flashcards were found in the answer.");
      return { kind: "cards", value: cards };
    }
    case "quiz": {
      const parsed = parseModelJson(raw) as Record<string, unknown>;
      const questions = normalizeQuiz(parsed.questions ?? parsed.quiz ?? parsed);
      if (!questions.length) throw new ModelOutputError("No quiz questions were found in the answer.");
      return { kind: "questions", value: questions };
    }
    case "terms": {
      const parsed = parseModelJson(raw) as Record<string, unknown>;
      const terms = normalizeTerms(parsed.terms ?? parsed.glossary ?? parsed);
      if (!terms.length) throw new ModelOutputError("No key terms were found in the answer.");
      return { kind: "terms", value: terms };
    }
  }
}

interface CallContext {
  cfg: AIConfig;
  tier: ContextTier;
  title: string;
  /** Number of blocks the source was split into (scales how much each part asks for). */
  parts: number;
}

/** One model call (with format retries and out-of-memory recovery) for one output from one block. */
async function generateOnce(ctx: CallContext, item: BatchItem, source: PromptSource, report: (tokens: number, text: string) => void): Promise<Part> {
  const { cfg, tier } = ctx;
  const system = buildSharedSystem(tier, source);
  const baseTask = buildTaskPrompt(item.type, tier, ctx.parts);
  let formatRetries = 0;
  let lastError: unknown;

  for (;;) {
    const task =
      formatRetries === 0
        ? baseTask
        : `${baseTask}\n\nIMPORTANT: your previous answer could not be used. Follow the OUTPUT format exactly and keep it short enough to finish.`;
    const numCtx = activeContextSize(cfg);
    const room = numCtx - estimateTokens(system) - estimateTokens(task) - 64;
    const numPredict = Math.min(predictBudget(item.type, tier, ctx.parts), cfg.maxPredict, room);
    if (numPredict < MIN_ANSWER_TOKENS) throw new NoRoomError();
    let text = "";
    try {
      const result = await chat({
        cfg,
        messages: [
          { role: "system", content: system },
          { role: "user", content: task },
        ],
        format: OUTPUT_SCHEMAS[item.type],
        numCtx,
        numPredict,
        signal: item.signal,
        onText: (piece) => {
          text += piece;
        },
        onProgress: (tokens) => report(tokens, text),
      });
      return parse(item.type, result.content, ctx.title);
    } catch (err) {
      if (err instanceof AIMemoryError) {
        // Use a smaller context for this and every later request, then try again.
        if (shrinkContextSize(cfg)) continue;
        throw err;
      }
      if (!(err instanceof ModelOutputError)) throw err;
      lastError = err;
      console.warn(`[study-suite] ${item.type}: unusable answer (attempt ${formatRetries + 1}): ${err.message}`);
      if (++formatRetries > 1) break;
    }
  }
  throw lastError instanceof Error ? lastError : new ModelOutputError("The answer could not be read.");
}

/** Generate for one block; if it doesn't fit in memory, split it in half and do each half. */
async function generateForBlock(
  ctx: CallContext,
  item: BatchItem,
  source: PromptSource,
  report: (tokens: number, text: string) => void,
  depth = 0,
): Promise<Part[]> {
  try {
    return [await withTransientRetries(ctx.cfg, item, () => generateOnce(ctx, item, source, report))];
  } catch (err) {
    const words = source.text ? countWords(source.text) : 0;
    const splittable = err instanceof NoRoomError || err instanceof AIMemoryError;
    if (!splittable || !source.text || words < MIN_SPLIT_WORDS * 2 || depth >= 4) {
      if (err instanceof NoRoomError) {
        throw new AIMemoryError("The AI's memory setting is too small for this request. Try a smaller AI_CONTEXT_SIZE value only if you set one; otherwise restart the app.");
      }
      throw err;
    }
    const halves = chunkText(source.text, { triggerWords: 0, maxWords: Math.ceil(words / 2) });
    const out: Part[] = [];
    for (const half of halves) out.push(...(await generateForBlock(ctx, item, { ...source, text: half.text }, report, depth + 1)));
    return out;
  }
}

/** The AI server is starting up or busy: wait a little and try again. */
async function withTransientRetries<T>(cfg: AIConfig, item: BatchItem, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || item.signal.aborted || !describeAIError(err, cfg.model).transient) throw err;
      item.onProgress({ tokens: 0, part: 1, parts: 1, note: "Waiting for the AI server…" });
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay);
        item.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
      });
      item.signal.throwIfAborted();
    }
  }
}

function demoteHeadings(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      return inFence ? line : line.replace(/^(#{1,5})(\s)/, "#$1$2");
    })
    .join("\n");
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function dedupeBy<T>(items: T[], pick: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(pick(item));
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function combine(type: OutputType, parts: Part[], title: string): OutputContent {
  switch (type) {
    case "notes":
    case "cheatsheet": {
      const md = parts.map((p) => (p.kind === "markdown" ? p.value : ""));
      const markdown =
        md.length === 1 ? md[0] : md.map((m, i) => `# Part ${i + 1}\n\n${demoteHeadings(m)}`).join("\n\n---\n\n");
      return { type, markdown };
    }
    case "flashcards":
      return { type, cards: dedupeBy(parts.flatMap((p) => (p.kind === "cards" ? p.value : [])), (c) => c.question) };
    case "quiz":
      return { type, questions: dedupeBy(parts.flatMap((p) => (p.kind === "questions" ? p.value : [])), (q) => q.question) };
    case "terms":
      return {
        type,
        terms: dedupeBy(parts.flatMap((p) => (p.kind === "terms" ? p.value : [])), (t) => t.term).sort((a, b) =>
          a.term.localeCompare(b.term, undefined, { sensitivity: "base" }),
        ),
      };
    case "mindmap": {
      const codes = parts.map((p) => (p.kind === "mindmap" ? p.value : ""));
      if (codes.length === 1) return { type, code: codes[0] };
      return {
        type,
        code: mergeMindmaps(
          title,
          codes.map((code, i) => ({ code, fallbackLabel: `Part ${i + 1}` })),
        ),
      };
    }
  }
}

/**
 * How many words of source fit in one request, leaving room for the
 * instructions and the longest answer in this batch.
 */
export function wordsPerBlock(cfg: AIConfig, tier: ContextTier, types: OutputType[], sampleText: string, topic = ""): { trigger: number; size: number } {
  const ctx = activeContextSize(cfg);
  const instructions = estimateTokens(buildSharedSystem(tier, { kind: "material", topic: topic || "x", title: "", text: "", part: { index: 0, total: 9, startWord: 99_999, endWord: 99_999 } }));
  const words = countWords(sampleText);
  const charsPerWord = words ? Math.max(4, sampleText.length / words) : 6.5;
  // Words that fit next to the instructions and the longest answer, when the source is split into `parts`.
  const fit = (parts: number) => {
    const reserve = Math.max(...types.map((t) => Math.min(predictBudget(t, tier, parts), cfg.maxPredict)));
    const longestTask = Math.max(...types.map((t) => estimateTokens(buildTaskPrompt(t, tier, parts))));
    const tokens = Math.max(400, ctx - reserve - instructions - longestTask - 160);
    return Math.max(MIN_SPLIT_WORDS, Math.floor((tokens * 3.2) / charsPerWord));
  };
  // Fits in one request: one block. Otherwise each part asks for shorter answers, so blocks can be bigger.
  return { trigger: Math.min(CHUNK_TRIGGER_WORDS, fit(1)), size: Math.min(CHUNK_SIZE_WORDS, fit(2)) };
}

/** Block size for the new-project form's "it will be read in N parts" hint. */
export function typicalBlockWords(cfg: AIConfig): { trigger: number; size: number } {
  return wordsPerBlock(cfg, "standard", OUTPUT_ORDER, "");
}

function blocksOf(cfg: AIConfig, tier: ContextTier, types: OutputType[], text: string, topic: string) {
  const { trigger, size } = wordsPerBlock(cfg, tier, types, text, topic);
  const words = countWords(text);
  // Too big for one request means at least two parts.
  return chunkText(text, { triggerWords: trigger, maxWords: words > trigger ? Math.min(size, Math.ceil(words / 2)) : size });
}

const LABEL: Record<OutputType, string> = {
  notes: "notes",
  cheatsheet: "cheat sheet",
  flashcards: "flashcards",
  quiz: "quiz",
  terms: "key terms",
  mindmap: "mind map",
};

/**
 * Make several outputs from one source, block by block: every output is
 * written from block 1 (read once, then cached), then from block 2, and so on.
 */
async function runTogether(ctx: Omit<CallContext, "parts">, items: BatchItem[], sources: PromptSource[], notesForMindmap?: string): Promise<Map<BatchItem, OutputContent>> {
  const done = new Map<BatchItem, OutputContent>();
  const parts = new Map<BatchItem, Part[]>(items.map((i) => [i, []]));
  const alive = new Set(items);
  const call: CallContext = { ...ctx, parts: sources.length };

  for (const [blockIndex, source] of sources.entries()) {
    for (const item of items) {
      if (!alive.has(item)) continue;
      if (item.signal.aborted) {
        alive.delete(item);
        await item.onFailed(item.signal.reason ?? new DOMException("Stopped", "AbortError"));
        continue;
      }
      // Tell the outputs still waiting what's happening.
      for (const other of alive) {
        if (other !== item) other.onProgress({ tokens: 0, part: blockIndex + 1, parts: sources.length, note: `Waiting while the ${LABEL[item.type]} ${item.type === "flashcards" || item.type === "terms" ? "are" : "is"} written…` });
      }
      const report = (tokens: number, text: string) => item.onProgress({ tokens, part: blockIndex + 1, parts: sources.length, text });
      report(0, "");
      try {
        parts.get(item)!.push(...(await generateForBlock(call, item, source, report)));
        if (blockIndex === sources.length - 1) {
          alive.delete(item);
          const content = combine(item.type, parts.get(item)!, ctx.title);
          done.set(item, content);
          await item.onDone(content);
        }
      } catch (err) {
        alive.delete(item);
        // A map that can't be read can still be drawn from the notes.
        if (item.type === "mindmap" && err instanceof ModelOutputError && notesForMindmap) {
          const derived = sanitizeMindmap("", ctx.title, notesForMindmap);
          if (derived) {
            const content: OutputContent = { type: "mindmap", code: derived };
            done.set(item, content);
            await item.onDone(content);
            continue;
          }
        }
        await item.onFailed(err);
      }
    }
  }
  return done;
}

function sourcesFrom(kind: "material" | "notes", base: { topic: string; title: string }, blocks: ReturnType<typeof chunkText>): PromptSource[] {
  return blocks.map((b) => ({
    kind,
    topic: base.topic,
    title: base.title,
    text: b.text,
    part: { index: b.index, total: blocks.length, startWord: b.startWord, endWord: b.endWord },
  }));
}

/** Make every requested output for one project. Each item reports back through its callbacks. */
export async function generateBatch(input: BatchInput): Promise<void> {
  const { cfg, tier, title, topic } = input;
  const items = [...input.items].sort((a, b) => OUTPUT_ORDER.indexOf(a.type) - OUTPUT_ORDER.indexOf(b.type));
  const types = items.map((i) => i.type);
  const ctx = { cfg, tier, title };
  const base = { topic, title };
  const hasMaterial = input.materialText.trim().length > 0;

  // Block the material once, sized for the longest answer in this batch, so
  // notes and the other outputs share blocks (and the cache).
  const materialBlocks = hasMaterial ? blocksOf(cfg, tier, types, input.materialText, topic) : [];
  const materialSources: PromptSource[] = hasMaterial ? sourcesFrom("material", base, materialBlocks) : [{ kind: "topic", ...base, text: null }];

  let notes = input.existingNotes?.trim() || undefined;
  const notesItem = items.find((i) => i.type === "notes");
  if (notesItem) {
    for (const other of items) if (other !== notesItem) other.onProgress({ tokens: 0, part: 1, parts: 1, note: "Waiting while the notes are written (the rest builds on them)…" });
    const made = await runTogether(ctx, [notesItem], materialSources);
    const content = made.get(notesItem);
    if (content?.type === "notes") notes = content.markdown;
  }

  const rest = items.filter((i) => i.type !== "notes");
  if (!rest.length) return;

  // Long material: the notes are a far shorter summary of it, so make the rest from them.
  let sources = materialSources;
  if (materialBlocks.length > 1 && notes) {
    sources = sourcesFrom("notes", base, blocksOf(cfg, tier, rest.map((i) => i.type), notes, topic));
  }
  await runTogether(ctx, rest, sources, notes);
}
