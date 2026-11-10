import type { OutputType } from "./types";

/** Everything a student can ask the app to create, in display order. */
export interface OutputInfo {
  type: OutputType;
  label: string;
  description: string;
  /** Route segment under /projects/[id]/ */
  path: string;
}

export const OUTPUTS: readonly OutputInfo[] = [
  { type: "notes", label: "Notes", description: "Detailed notes with examples, analogies and the blind spots students miss", path: "notes" },
  { type: "cheatsheet", label: "Cheat sheet", description: "One page of key ideas, formulas and common mistakes", path: "cheatsheet" },
  { type: "flashcards", label: "Flashcards", description: "Active-recall cards with spaced-repetition review", path: "flashcards" },
  { type: "quiz", label: "Quiz", description: "Multiple-choice practice with instant feedback", path: "quiz" },
  { type: "mindmap", label: "Mind map", description: "A visual map of how every idea connects", path: "mindmap" },
  { type: "terms", label: "Key terms", description: "A glossary of every term you need to know", path: "terms" },
] as const;

export const OUTPUT_TYPES: readonly OutputType[] = OUTPUTS.map((o) => o.type);

export const DEFAULT_OUTPUTS: readonly OutputType[] = ["notes", "flashcards", "quiz"];

export function outputInfo(type: OutputType): OutputInfo {
  return OUTPUTS.find((o) => o.type === type)!;
}

export function isOutputType(value: unknown): value is OutputType {
  return typeof value === "string" && (OUTPUT_TYPES as readonly string[]).includes(value);
}
