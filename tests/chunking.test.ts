import { describe, expect, it } from "vitest";
import { chunkText, countWords, CHUNK_SIZE_WORDS, estimateSegments } from "@/lib/text/chunking";

const sentence = (i: number) => `Sentence number ${i} explains entropy and energy flow in closed systems.`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("  hello   world\n\tagain ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

describe("chunkText", () => {
  it("does not chunk at or below 15,000 words", () => {
    const text = words(15_000);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].wordCount).toBe(15_000);
  });

  it("splits large inputs into chronological blocks of at most 8,000 words without losing words", () => {
    const paragraphs = Array.from({ length: 400 }, (_, p) =>
      Array.from({ length: 6 }, (_, s) => sentence(p * 6 + s)).join(" "),
    ).join("\n\n");
    const total = countWords(paragraphs);
    expect(total).toBeGreaterThan(15_000);

    const chunks = chunkText(paragraphs);
    expect(chunks.length).toBe(estimateSegments(total));
    for (const c of chunks) expect(c.wordCount).toBeLessThanOrEqual(CHUNK_SIZE_WORDS);
    expect(chunks.reduce((sum, c) => sum + c.wordCount, 0)).toBe(total);
    // chronological and contiguous
    expect(chunks[0].startWord).toBe(1);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].startWord).toBe(chunks[i - 1].endWord + 1);
    expect(chunks.at(-1)!.endWord).toBe(total);
    // re-joining preserves the word sequence exactly
    expect(chunks.map((c) => c.text).join(" ").split(/\s+/)).toEqual(paragraphs.split(/\s+/));
    // splits land on sentence boundaries
    for (const c of chunks.slice(0, -1)) expect(c.text.trim().endsWith(".")).toBe(true);
  });

  it("hard-splits unpunctuated transcripts and balances the final block", () => {
    const text = words(16_050);
    const chunks = chunkText(text);
    expect(chunks.length).toBe(3);
    expect(Math.min(...chunks.map((c) => c.wordCount))).toBeGreaterThan(5_000);
    expect(chunks.reduce((s, c) => s + c.wordCount, 0)).toBe(16_050);
  });
});
