import { describe, expect, it } from "vitest";
import {
  cleanMarkdownOutput,
  normalizeFlashcards,
  normalizeQuiz,
  normalizeTerms,
  parseModelJson,
  repairDecodedControlChars,
  repairLatexEscapes,
  stripThinking,
} from "@/lib/ai/normalize";

describe("LaTeX escape repair", () => {
  it("keeps LaTeX intact when the model forgot to double backslashes", () => {
    const raw = String.raw`{"deepNotes": "Use $\frac{a}{b}$, $\alpha + \beta$, $\theta$, $\nabla f$, $\rho$ and $\sqrt{x}$.\nNext line\tand tab."}`;
    const parsed = JSON.parse(repairLatexEscapes(raw)) as { deepNotes: string };
    expect(parsed.deepNotes).toContain(String.raw`$\frac{a}{b}$`);
    expect(parsed.deepNotes).toContain(String.raw`$\alpha + \beta$`);
    expect(parsed.deepNotes).toContain(String.raw`$\theta$`);
    expect(parsed.deepNotes).toContain(String.raw`$\nabla f$`);
    expect(parsed.deepNotes).toContain(String.raw`$\rho$`);
    expect(parsed.deepNotes).toContain("\nNext line\tand tab.");
  });

  it("leaves correctly escaped JSON untouched", () => {
    const raw = String.raw`{"a": "$\\frac{1}{2}$ \"quoted\" é line\nbreak"}`;
    expect(JSON.parse(repairLatexEscapes(raw))).toEqual(JSON.parse(raw));
  });

  it("repairs control characters produced by valid-but-wrong escapes", () => {
    expect(repairDecodedControlChars("$\frac{1}{2}$")).toBe(String.raw`$\frac{1}{2}$`);
    expect(repairDecodedControlChars("$\theta$")).toBe(String.raw`$\theta$`);
  });

  it("extracts JSON from fenced or chatty output", () => {
    expect(parseModelJson('Sure! ```json\n{"x": 1}\n``` hope that helps')).toEqual({ x: 1 });
  });

  it("does not mistake a fence inside a JSON string for the answer's fence", () => {
    const raw = String.raw`{"mindMapCode": "` + "```mermaid\\nmindmap\\n  root((A $\\frac{a}{b}$))\\n```" + String.raw`", "deepNotes": "$\alpha$"}`;
    const parsed = parseModelJson(raw) as { mindMapCode: string; deepNotes: string };
    expect(parsed.mindMapCode.startsWith("```mermaid\nmindmap")).toBe(true);
    expect(parsed.deepNotes).toBe(String.raw`$\alpha$`);
  });
});

describe("quiz coercion", () => {
  it("normalises letters, prefixes and answer text", () => {
    const quiz = normalizeQuiz([
      { question: "Q1?", options: ["A) one", "B) two", "C) three", "D) four"], correctAnswer: "B", explanation: "e" },
      { question: "Q2?", options: { A: "red", B: "green", C: "blue", D: "pink" }, correct_answer: "Option C" },
      { question: "Q3?", choices: ["alpha", "beta", "gamma", "delta"], answer: "delta" },
      { question: "Q4?", options: ["x", "y", "z", "w"], correctAnswer: 0 },
      { question: "bad", options: ["only one"], correctAnswer: "A" },
    ]);
    expect(quiz.map((q) => q.correctAnswer)).toEqual(["B", "C", "D", "A"]);
    expect(quiz[0].options).toEqual(["one", "two", "three", "four"]);
  });
});

describe("flashcards coercion", () => {
  it("accepts alternate keys, Q/A strings and drops duplicates", () => {
    const cards = normalizeFlashcards([
      { front: "What is entropy?", back: "Disorder measure" },
      "Q: Define enthalpy A: H = U + PV",
      { question: "What is entropy?", answer: "dup" },
      { question: "", answer: "empty" },
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[1]).toEqual({ question: "Define enthalpy", answer: "H = U + PV" });
  });
});

describe("free-text and thinking-model output", () => {
  it("removes <think> blocks before the answer", () => {
    expect(stripThinking("<think>let me plan {json}</think>\n{\"a\": 1}")).toBe('{"a": 1}');
    expect(parseModelJson('<think>reasoning with { braces }</think>{"x": 2}')).toEqual({ x: 2 });
  });

  it("unwraps a fenced Markdown answer and normalises math", () => {
    expect(cleanMarkdownOutput("```markdown\n# Title\n\\(x^2\\)\n```")).toBe("# Title\n$x^2$");
  });
});

describe("key terms", () => {
  it("normalises, dedupes and sorts terms", () => {
    const terms = normalizeTerms([
      { term: "Entropy", definition: "Disorder" },
      { name: "enthalpy", meaning: "Heat content" },
      "**Gibbs energy**: Free energy",
      { term: "entropy", definition: "dup" },
    ]);
    expect(terms.map((t) => t.term)).toEqual(["enthalpy", "Entropy", "Gibbs energy"]);
  });
});
