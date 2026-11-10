import "server-only";

import type { ContextTier, Flashcard, KeyTerm, OutputContent, OutputType, QuizQuestion } from "../types";
import { chunkText, countWords } from "../text/chunking";
import { mergeMindmaps, parseMindmap, sanitizeMindmap } from "../mindmap";
import type { AIConfig } from "./config";
import { AIMemoryError, chat } from "./ollama";
import { buildSystemPrompt, buildUserPrompt, OUTPUT_SCHEMAS, predictBudget } from "./prompts";
import {
  cleanMarkdownOutput,
  ModelOutputError,
  normalizeFlashcards,
  normalizeQuiz,
  normalizeTerms,
  parseModelJson,
  stripThinking,
} from "./normalize";

export interface GenerateInput {
  cfg: AIConfig;
  type: OutputType;
  tier: ContextTier;
  title: string;
  topic: string;
  /** All materials joined; empty string for topic-only projects. */
  materialText: string;
  /** Existing notes, used to derive a mind map if the model's map is unusable. */
  notesMarkdown?: string;
  signal?: AbortSignal;
  onProgress?: (p: { tokens: number; part: number; parts: number }) => void;
}

type Part =
  | { kind: "markdown"; value: string }
  | { kind: "cards"; value: Flashcard[] }
  | { kind: "questions"; value: QuizQuestion[] }
  | { kind: "terms"; value: KeyTerm[] }
  | { kind: "mindmap"; value: string };

const MIN_CONTEXT = 4096;
const MIN_SPLIT_WORDS = 250;
const MAX_MEMORY_SHRINKS = 2;

/** Size the context window to the request so small machines don't run out of memory. */
export function contextFor(system: string, user: string, numPredict: number, maxContext: number): number {
  const promptTokens = Math.ceil((system.length + user.length) / 3.2); // conservative chars-per-token
  const needed = Math.ceil((promptTokens + numPredict + 512) / 1024) * 1024;
  return Math.min(maxContext, Math.max(MIN_CONTEXT, needed));
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

interface PartRequest {
  text: string | null;
  part?: { index: number; total: number; startWord: number; endWord: number };
}

async function generateOnce(input: GenerateInput, req: PartRequest, multiPart: boolean, onTokens: (n: number) => void): Promise<Part> {
  const { cfg, type, tier } = input;
  const system = buildSystemPrompt({ type, tier, mode: req.text === null ? "topic" : "material", multiPart });
  const baseUser = buildUserPrompt({ topic: input.topic, title: input.title, text: req.text, part: req.part });
  let numPredict = Math.min(predictBudget(type, tier), cfg.maxPredict);
  let memoryShrinks = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt++) {
    const user =
      attempt === 0
        ? baseUser
        : `${baseUser}\n\nIMPORTANT: your previous answer could not be used. Follow the OUTPUT format exactly and keep it concise enough to finish.`;
    try {
      const result = await chat({
        cfg,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        format: OUTPUT_SCHEMAS[type],
        numCtx: contextFor(system, user, numPredict, cfg.maxContext),
        numPredict,
        signal: input.signal,
        onProgress: onTokens,
      });
      return parse(type, result.content, input.title);
    } catch (err) {
      if (err instanceof AIMemoryError && memoryShrinks < MAX_MEMORY_SHRINKS && numPredict > 768) {
        // Retry with a smaller answer budget (and therefore a smaller context window).
        memoryShrinks++;
        numPredict = Math.max(768, Math.floor(numPredict / 2));
        lastError = err;
        continue;
      }
      if (!(err instanceof ModelOutputError)) throw err;
      lastError = err;
      console.warn(`[study-suite] ${type}: unusable answer (attempt ${attempt + 1}): ${err.message}`);
      if (attempt >= 1) break;
    }
  }
  throw lastError instanceof Error ? lastError : new ModelOutputError("The answer could not be read.");
}

/** Generate for a block of text; on memory errors, split the block in half and retry each half. */
async function generateForBlock(
  input: GenerateInput,
  req: PartRequest,
  multiPart: boolean,
  onTokens: (n: number) => void,
  depth = 0,
): Promise<Part[]> {
  try {
    return [await generateOnce(input, req, multiPart, onTokens)];
  } catch (err) {
    const words = req.text ? countWords(req.text) : 0;
    if (!(err instanceof AIMemoryError) || !req.text || words < MIN_SPLIT_WORDS * 2 || depth >= 4) throw err;
    const halves = chunkText(req.text, { triggerWords: 0, maxWords: Math.ceil(words / 2) });
    const out: Part[] = [];
    for (const half of halves) {
      out.push(...(await generateForBlock(input, { text: half.text, part: req.part }, true, onTokens, depth + 1)));
    }
    return out;
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

/** Produce one output for a project, chunking long material and merging the parts. */
export async function generateOutput(input: GenerateInput): Promise<OutputContent> {
  const hasMaterial = input.materialText.trim().length > 0;
  const chunks = hasMaterial ? chunkText(input.materialText) : [];
  const requests: PartRequest[] = hasMaterial
    ? chunks.map((c) => ({
        text: c.text,
        part: { index: c.index, total: chunks.length, startWord: c.startWord, endWord: c.endWord },
      }))
    : [{ text: null }];

  const parts: Part[] = [];
  for (const [i, req] of requests.entries()) {
    input.signal?.throwIfAborted();
    input.onProgress?.({ tokens: 0, part: i + 1, parts: requests.length });
    try {
      parts.push(
        ...(await generateForBlock(input, req, requests.length > 1, (tokens) =>
          input.onProgress?.({ tokens, part: i + 1, parts: requests.length }),
        )),
      );
    } catch (err) {
      // A map that can't be read can still be derived from the notes.
      if (input.type === "mindmap" && err instanceof ModelOutputError && input.notesMarkdown) {
        const derived = sanitizeMindmap("", input.title, input.notesMarkdown);
        if (derived) return { type: "mindmap", code: derived };
      }
      throw err;
    }
  }
  return combine(input.type, parts, input.title);
}
