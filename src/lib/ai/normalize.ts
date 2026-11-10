/**
 * Turns raw local-model output into a validated StudySuite.
 *
 * Small local models are good but not perfect JSON writers. This module:
 *  1. extracts the JSON object (tolerating fences / preambles),
 *  2. repairs LaTeX backslashes that were not escaped for JSON
 *     (e.g. "\frac" would otherwise decode to a form-feed + "rac"),
 *  3. coerces loosely-shaped fields into the strict schema.
 */

import type { Flashcard, KeyTerm, OptionLetter, QuizQuestion } from "../types";
import { OPTION_LETTERS } from "../types";
import { normalizeMath } from "../math";

export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelOutputError";
  }
}

/* -------------------------------------------------------------------------- */
/* JSON extraction & repair                                                   */
/* -------------------------------------------------------------------------- */

/** Remove reasoning blocks that "thinking" models (qwen3, deepseek-r1…) may emit before the answer. */
export function stripThinking(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "") // an unclosed opening tag was cut off upstream
    .trim();
}

export function extractJsonObject(raw: string): string {
  let text = stripThinking(raw.replace(/^\uFEFF/, "")).trim();
  // Only unwrap a fence when the answer itself is fenced; fences *inside* JSON
  // strings (e.g. a ```mermaid block in mindMapCode) must be left alone.
  if (!text.startsWith("{")) {
    const fenced = text.match(/```(?:json|JSON)?[ \t]*\n?\s*(\{[\s\S]*\})\s*```/);
    if (fenced) text = fenced[1];
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new ModelOutputError("The model did not return a JSON object.");
  return text.slice(start, end + 1);
}

// LaTeX commands that collide with valid JSON escapes (\n, \t, \r). Only
// these exact command words are treated as LaTeX, so real newlines/tabs survive.
const N_COMMANDS = /^n(?:abla|eq|e|u|eg|otin|exists|geq|leq|mid|ewline|parallel|subseteq)(?![a-zA-Z])/;
const T_COMMANDS = /^t(?:heta|au|imes|ext|extbf|extit|extrm|an|anh|o|ilde|op|riangle|frac|herefore|riangleq)(?![a-zA-Z])/;
const R_COMMANDS = /^r(?:ho|ight[a-zA-Z]*|angle|m|brace|brack|ceil|floor)(?![a-zA-Z])/;

/**
 * Walks the raw JSON text and doubles any backslash inside a string literal
 * that is obviously a LaTeX command rather than a JSON escape.
 */
export function repairLatexEscapes(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch !== "\\") {
      out += ch;
      continue;
    }

    const next = json[i + 1] ?? "";
    const rest = json.slice(i + 1, i + 24);

    if (next === "\\" || next === '"' || next === "/") {
      out += ch + next;
      i++;
    } else if (next === "u") {
      if (/^u[0-9a-fA-F]{4}/.test(rest)) {
        out += ch + json.slice(i + 1, i + 6);
        i += 5;
      } else {
        out += "\\\\"; // \underline, \upsilon, \uparrow ...
      }
    } else if (next === "b" || next === "f") {
      // \beta, \bar, \begin, \frac, \forall ... (a real \b or \f never precedes a letter)
      if (/^[bf][a-zA-Z]/.test(rest)) {
        out += "\\\\";
      } else {
        out += ch + next;
        i++;
      }
    } else if (next === "n" || next === "t" || next === "r") {
      const isLatex = (next === "n" ? N_COMMANDS : next === "t" ? T_COMMANDS : R_COMMANDS).test(rest);
      if (isLatex) {
        out += "\\\\";
      } else {
        out += ch + next;
        i++;
      }
    } else {
      // Invalid JSON escape such as \alpha, \sigma, \pi, \{, \(, \, -> keep it literally.
      out += "\\\\";
    }
  }
  return out;
}

/** Post-parse safety net for LaTeX commands that were decoded into control characters. */
export function repairDecodedControlChars(value: string): string {
  return value
    .replace(/\f/g, "\\f")
    .replace(/\u0008/g, "\\b")
    .replace(/\t(?=[a-z])/g, "\\t")
    .replace(/\r(?=[a-z])/g, "\\r")
    .replace(/\n(?=(?:abla|eq|eg|otin|exists|geq|leq|mid)(?![a-zA-Z]))/g, "\\n");
}

export function parseModelJson(raw: string): unknown {
  const candidate = extractJsonObject(raw);
  try {
    return JSON.parse(repairLatexEscapes(candidate));
  } catch {
    try {
      return JSON.parse(candidate);
    } catch {
      throw new ModelOutputError("The model returned malformed JSON.");
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Field coercion                                                             */
/* -------------------------------------------------------------------------- */

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);

function asText(value: unknown): string {
  if (typeof value === "string") return repairDecodedControlChars(value).trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n");
  if (isObject(value)) {
    for (const key of ["text", "content", "value", "markdown", "label"]) {
      if (key in value) return asText(value[key]);
    }
  }
  return "";
}

function pick(obj: Loose, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  // case-insensitive fallback
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const v = lower[key.toLowerCase()];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function normalizeFlashcards(value: unknown): Flashcard[] {
  const list = Array.isArray(value) ? value : isObject(value) ? Object.values(value) : [];
  const seen = new Set<string>();
  const cards: Flashcard[] = [];

  for (const item of list) {
    let question = "";
    let answer = "";
    if (isObject(item)) {
      question = asText(pick(item, ["question", "q", "front", "term", "prompt"]));
      answer = asText(pick(item, ["answer", "a", "back", "definition", "response"]));
    } else if (typeof item === "string") {
      const m = item.match(/Q:\s*([\s\S]+?)\s*A:\s*([\s\S]+)/i);
      if (m) [question, answer] = [m[1].trim(), m[2].trim()];
    }
    question = question.replace(/^Q:\s*/i, "");
    answer = answer.replace(/^A:\s*/i, "");
    if (!question || !answer) continue;
    const key = normKey(question);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ question: normalizeMath(question), answer: normalizeMath(answer) });
  }
  return cards.slice(0, 80);
}

const OPTION_PREFIX = /^\s*(?:\(?([A-Da-d])[).:\]-]|option\s+([A-Da-d])\s*[:.)-]?)\s+/i;

function stripOptionPrefix(text: string): string {
  return text.replace(OPTION_PREFIX, "").trim();
}

function resolveCorrectIndex(raw: unknown, options: string[]): number {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    if (raw >= 0 && raw < options.length) return raw; // 0-based
    if (raw >= 1 && raw <= options.length) return raw - 1;
  }
  const text = asText(raw);
  if (!text) return -1;

  const letter = text.match(/^\s*(?:option\s+)?\(?([A-Da-d])\)?(?:[).:\s]|$)/i);
  if (letter) {
    const idx = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (idx < options.length) return idx;
  }
  const target = normKey(stripOptionPrefix(text));
  const exact = options.findIndex((o) => normKey(o) === target);
  if (exact !== -1) return exact;
  return options.findIndex((o) => target.length > 3 && (normKey(o).includes(target) || target.includes(normKey(o))));
}

export function normalizeQuiz(value: unknown): QuizQuestion[] {
  const list = Array.isArray(value) ? value : isObject(value) ? Object.values(value) : [];
  const seen = new Set<string>();
  const questions: QuizQuestion[] = [];

  for (const item of list) {
    if (!isObject(item)) continue;
    const question = asText(pick(item, ["question", "prompt", "q", "stem"])).replace(/^Question:\s*/i, "");

    const rawOptions = pick(item, ["options", "choices", "answers"]);
    let options: string[] = [];
    if (Array.isArray(rawOptions)) {
      options = rawOptions.map((o) => stripOptionPrefix(asText(o)));
    } else if (isObject(rawOptions)) {
      options = OPTION_LETTERS.filter((l) => rawOptions[l] ?? rawOptions[l.toLowerCase()]).map((l) =>
        stripOptionPrefix(asText(rawOptions[l] ?? rawOptions[l.toLowerCase()])),
      );
    } else {
      options = OPTION_LETTERS.map((l) => asText(item[l] ?? item[l.toLowerCase()])).filter(Boolean);
    }
    options = options.filter(Boolean);

    const correctIndex = resolveCorrectIndex(
      pick(item, ["correctAnswer", "correct_answer", "correct", "answer", "correctOption"]),
      options,
    );

    if (!question || options.length < 2 || correctIndex < 0) continue;

    // Keep at most four options, making sure the correct one survives.
    if (options.length > 4) {
      if (correctIndex >= 4) continue;
      options = options.slice(0, 4);
    }

    const key = normKey(question);
    if (seen.has(key)) continue;
    seen.add(key);

    questions.push({
      question: normalizeMath(question),
      options: options.map(normalizeMath),
      correctAnswer: OPTION_LETTERS[correctIndex] as OptionLetter,
      explanation: normalizeMath(asText(pick(item, ["explanation", "rationale", "reason", "why"]))),
    });
  }
  return questions.slice(0, 50);
}

export function normalizeTerms(value: unknown): KeyTerm[] {
  const list = Array.isArray(value) ? value : isObject(value) ? Object.values(value) : [];
  const seen = new Set<string>();
  const terms: KeyTerm[] = [];
  for (const item of list) {
    let term = "";
    let definition = "";
    if (isObject(item)) {
      term = asText(pick(item, ["term", "name", "word", "concept", "title"]));
      definition = asText(pick(item, ["definition", "meaning", "description", "explanation"]));
    } else if (typeof item === "string") {
      const m = item.match(/^\s*\**([^:*]+?)\**\s*[:\-–—]\s*([\s\S]+)$/);
      if (m) [term, definition] = [m[1].trim(), m[2].trim()];
    }
    if (!term || !definition) continue;
    const key = normKey(term);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push({ term: normalizeMath(term), definition: normalizeMath(definition) });
  }
  return terms.sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" })).slice(0, 120);
}

/**
 * Clean a free-text Markdown answer: drop reasoning blocks, unwrap an answer
 * that was wrapped in one big code fence, normalise LaTeX.
 */
export function cleanMarkdownOutput(raw: string): string {
  let text = stripThinking(raw).replace(/^\uFEFF/, "").trim();
  const fenced = text.match(/^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```\s*$/i);
  if (fenced) text = fenced[1].trim();
  return normalizeMath(text);
}
