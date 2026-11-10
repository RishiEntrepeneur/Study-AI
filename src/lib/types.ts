/**
 * Shared contracts between the private AI pipeline (server) and the dashboard (client).
 */

export type ContextTier = "standard" | "deep_dive";

export const CONTEXT_TIERS: readonly ContextTier[] = ["standard", "deep_dive"] as const;

export type OptionLetter = "A" | "B" | "C" | "D";

export const OPTION_LETTERS: readonly OptionLetter[] = ["A", "B", "C", "D"] as const;

export interface Flashcard {
  question: string;
  answer: string;
}

export interface QuizQuestion {
  question: string;
  /** Option texts in A, B, C, D order (2–4 entries, usually 4). */
  options: string[];
  correctAnswer: OptionLetter;
  explanation: string;
}

/** The exact JSON object the private AI is instructed to return. */
export interface StudySuite {
  deepNotes: string;
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
  mindMapCode: string;
}

export interface SuiteMeta {
  title: string;
  model: string;
  tier: ContextTier;
  wordCount: number;
  segments: number;
  durationMs: number;
  generatedAt: string;
}

/** What POST /api/generate returns on success. */
export interface StudySuiteResponse extends StudySuite {
  meta: SuiteMeta;
}

export interface GenerateRequestBody {
  sourceText: string;
  contextTier: ContextTier;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  detail?: string;
}

/**
 * Progress events streamed as NDJSON when the client sends
 * `Accept: application/x-ndjson`. One JSON object per line.
 */
export type PipelineEvent =
  | { type: "plan"; wordCount: number; segments: number; chunked: boolean }
  | { type: "segment_start"; index: number; total: number; words: number }
  | { type: "segment_progress"; index: number; total: number; tokens: number }
  | { type: "segment_done"; index: number; total: number }
  | { type: "synthesis_start" }
  | { type: "result"; data: StudySuiteResponse }
  | { type: "error"; status: number; error: string; code?: string; detail?: string };
