import "server-only";

import type { ContextTier, PipelineEvent, StudySuite, StudySuiteResponse } from "../types";
import { chunkText, countWords, type TextChunk } from "../text/chunking";
import { mergeMindmaps, mindmapRootLabel, parseMindmap } from "../mindmap";
import type { AIConfig } from "./config";
import { chatJSON } from "./ollama";
import {
  buildSynthesisPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  STUDY_SUITE_JSON_SCHEMA,
  SYNTHESIS_JSON_SCHEMA,
  SYNTHESIS_SYSTEM_PROMPT,
} from "./prompts";
import { ModelOutputError, normalizeDeepNotes, normalizeStudySuite, parseModelJson } from "./normalize";

export interface PipelineOptions {
  cfg: AIConfig;
  sourceText: string;
  tier: ContextTier;
  signal?: AbortSignal;
  emit?: (event: PipelineEvent) => void;
}

const MAX_MODEL_CONTEXT = 131_072; // llama3.1's native window
const GENERIC_TITLES = /^(main topic|root|topic|study suite|lecture|concept architecture|overview|notes)$/i;

/**
 * Pick a context window large enough for the prompt plus the full answer so
 * Ollama never silently truncates the beginning of the lecture (its default
 * window is only a few thousand tokens).
 */
export function contextWindowFor(system: string, user: string, cfg: AIConfig, numPredict = cfg.numPredict): number {
  const promptTokens = Math.ceil((system.length + user.length) / 3.2); // conservative chars-per-token
  const needed = promptTokens + numPredict + 512;
  const rounded = Math.ceil(needed / 2048) * 2048;
  return Math.min(MAX_MODEL_CONTEXT, Math.max(cfg.numCtx, rounded));
}

/** Key concepts of a suite, used as rolling context and for the synthesis pass. */
export function conceptsOf(suite: StudySuite, limit = 30): string[] {
  const concepts: string[] = [];
  const tree = parseMindmap(suite.mindMapCode);
  for (const branch of tree?.children ?? []) {
    concepts.push(branch.label);
    for (const leaf of branch.children.slice(0, 4)) concepts.push(leaf.label);
  }
  for (const match of suite.deepNotes.matchAll(/^\s*[-*]\s+\*\*(.+?)\*\*/gm)) concepts.push(match[1]);
  const seen = new Set<string>();
  return concepts
    .map((c) => c.replace(/[:：]$/, "").trim())
    .filter((c) => {
      const key = c.toLowerCase();
      if (!c || c.length > 80 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function titleOf(suite: StudySuite, fallback: string): string {
  const root = mindmapRootLabel(suite.mindMapCode);
  if (root && !GENERIC_TITLES.test(root)) return root;
  for (const match of suite.deepNotes.matchAll(/^#{1,2}\s+(.+)$/gm)) {
    const heading = match[1].replace(/[*_`#]/g, "").trim();
    if (heading && !GENERIC_TITLES.test(heading)) return heading.slice(0, 60);
  }
  return fallback;
}

/** Demote headings by one level so each segment nests under its own "Part" heading. */
function demoteHeadings(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return line.replace(/^(#{1,5})(\s)/, "#$1$2");
    })
    .join("\n");
}

const dedupeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function generateSegment(
  opts: PipelineOptions,
  system: string,
  chunk: TextChunk,
  total: number,
  covered: string[],
): Promise<StudySuite> {
  const { cfg, signal, emit } = opts;
  const baseUser = buildUserPrompt(
    chunk.text,
    total > 1
      ? { index: chunk.index, total, startWord: chunk.startWord, endWord: chunk.endWord, coveredConcepts: covered }
      : undefined,
  );

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? baseUser
        : `${baseUser}\n\nIMPORTANT: your previous answer was not valid JSON or was cut off. Return ONLY the JSON object, and keep "deepNotes" focused enough to finish within the length limit.`;
    const result = await chatJSON({
      cfg,
      system,
      user,
      schema: STUDY_SUITE_JSON_SCHEMA,
      numCtx: contextWindowFor(system, user, cfg),
      signal,
      onProgress: (tokens) => emit?.({ type: "segment_progress", index: chunk.index, total, tokens }),
    });
    try {
      return normalizeStudySuite(parseModelJson(result.content), `Segment ${chunk.index + 1}`);
    } catch (err) {
      if (!(err instanceof ModelOutputError)) throw err;
      lastError = err;
      console.warn(
        `[study-suite] segment ${chunk.index + 1}/${total} attempt ${attempt + 1}: ${err.message} (done_reason=${result.doneReason ?? "?"}, tokens=${result.tokens})`,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new ModelOutputError("The model output could not be parsed.");
}

async function synthesize(
  opts: PipelineOptions,
  outlines: Array<{ index: number; title: string; concepts: string[] }>,
): Promise<{ title: string; overview: string } | null> {
  const user = buildSynthesisPrompt(outlines);
  const numPredict = 3_072;
  try {
    const result = await chatJSON({
      cfg: opts.cfg,
      system: SYNTHESIS_SYSTEM_PROMPT,
      user,
      schema: SYNTHESIS_JSON_SCHEMA,
      numPredict,
      numCtx: contextWindowFor(SYNTHESIS_SYSTEM_PROMPT, user, opts.cfg, numPredict),
      signal: opts.signal,
    });
    const parsed = parseModelJson(result.content) as { title?: unknown; overview?: unknown };
    const overview = normalizeDeepNotes(parsed.overview);
    if (!overview) return null;
    const title = typeof parsed.title === "string" ? parsed.title.replace(/[*_`#"]/g, "").trim().slice(0, 60) : "";
    return { title, overview };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    // Synthesis is an enhancement; the merged segments are already complete.
    console.warn(`[study-suite] synthesis skipped: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Full pipeline: chunk → generate each segment with rolling context →
 * synthesise → merge. Every word of the source is sent to the model exactly once.
 */
export async function runStudySuitePipeline(opts: PipelineOptions): Promise<StudySuiteResponse> {
  const { cfg, sourceText, tier, emit } = opts;
  const started = Date.now();
  const wordCount = countWords(sourceText);
  const chunks = chunkText(sourceText);
  const total = chunks.length;

  emit?.({ type: "plan", wordCount, segments: total, chunked: total > 1 });

  const system = buildSystemPrompt(tier);
  const suites: StudySuite[] = [];
  const covered: string[] = [];

  for (const chunk of chunks) {
    opts.signal?.throwIfAborted();
    emit?.({ type: "segment_start", index: chunk.index, total, words: chunk.wordCount });
    const suite = await generateSegment(opts, system, chunk, total, covered.slice(-60));
    suites.push(suite);
    covered.push(...conceptsOf(suite, 20));
    emit?.({ type: "segment_done", index: chunk.index, total });
  }

  const meta = (title: string) => ({
    title,
    model: cfg.model,
    tier,
    wordCount,
    segments: total,
    durationMs: Date.now() - started,
    generatedAt: new Date().toISOString(),
  });

  if (suites.length === 1) {
    const [suite] = suites;
    return { ...suite, meta: meta(titleOf(suite, "Study Suite")) };
  }

  emit?.({ type: "synthesis_start" });
  const outlines = suites.map((suite, index) => ({
    index,
    title: titleOf(suite, `Segment ${index + 1}`),
    concepts: conceptsOf(suite, 25),
  }));
  const synthesis = await synthesize(opts, outlines);
  const title = synthesis?.title || outlines[0].title;

  const notes: string[] = [];
  if (synthesis) notes.push(`# Master Synthesis\n\n${demoteHeadings(synthesis.overview)}`);
  suites.forEach((suite, i) => {
    const c = chunks[i];
    notes.push(
      `# Part ${i + 1} · ${outlines[i].title}\n\n> Lecture words ${c.startWord.toLocaleString("en-US")}–${c.endWord.toLocaleString("en-US")}\n\n${demoteHeadings(suite.deepNotes)}`,
    );
  });

  const seenCards = new Set<string>();
  const seenQuestions = new Set<string>();

  return {
    deepNotes: notes.join("\n\n---\n\n"),
    flashcards: suites.flatMap((s) => s.flashcards).filter((card) => {
      const key = dedupeKey(card.question);
      if (seenCards.has(key)) return false;
      seenCards.add(key);
      return true;
    }),
    quiz: suites.flatMap((s) => s.quiz).filter((q) => {
      const key = dedupeKey(q.question);
      if (seenQuestions.has(key)) return false;
      seenQuestions.add(key);
      return true;
    }),
    mindMapCode: mergeMindmaps(
      title,
      suites.map((suite, i) => ({ code: suite.mindMapCode, fallbackLabel: outlines[i].title })),
    ),
    meta: meta(title),
  };
}
