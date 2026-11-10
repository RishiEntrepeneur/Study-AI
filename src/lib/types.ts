/**
 * Shared contracts between the server and the browser.
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

export interface KeyTerm {
  term: string;
  definition: string;
}

export type OutputType = "notes" | "cheatsheet" | "flashcards" | "quiz" | "mindmap" | "terms";

export type OutputContent =
  | { type: "notes"; markdown: string }
  | { type: "cheatsheet"; markdown: string }
  | { type: "flashcards"; cards: Flashcard[] }
  | { type: "quiz"; questions: QuizQuestion[] }
  | { type: "mindmap"; code: string }
  | { type: "terms"; terms: KeyTerm[] };

export type ContentOf<T extends OutputType> = Extract<OutputContent, { type: T }>;

export type GenerationStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface GenerationProgress {
  tokens: number;
  part: number;
  parts: number;
  note?: string;
}

/** What GET /api/projects/[id]/status returns per output. */
export interface GenerationStatusView {
  id: string;
  type: OutputType;
  status: GenerationStatus;
  error: string | null;
  hasContent: boolean;
  progress: GenerationProgress | null;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  detail?: string;
}
