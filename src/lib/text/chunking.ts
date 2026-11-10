/**
 * Word-aware, boundary-respecting chunker.
 *
 * Inputs above CHUNK_TRIGGER_WORDS are split into chronological blocks of at
 * most CHUNK_SIZE_WORDS words. Splits prefer paragraph breaks, then line
 * breaks, then sentence ends, and only hard-split by words as a last resort
 * (e.g. auto-captions with no punctuation). Block sizes are balanced so the
 * final block is never a tiny fragment, and no words are ever dropped.
 */

export const CHUNK_TRIGGER_WORDS = 15_000;
export const CHUNK_SIZE_WORDS = 8_000;

export interface TextChunk {
  /** 0-based position in the original text. */
  index: number;
  text: string;
  wordCount: number;
  /** 1-based inclusive word range within the full source. */
  startWord: number;
  endWord: number;
}

export function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Matches the JS \s class closely enough for counting purposes.
    const isSpace =
      code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 0x2028 || code === 0x2029 || code === 0xfeff ||
      (code >= 0x2000 && code <= 0x200a) || code === 0x3000 || code === 0x1680 || code === 0x202f || code === 0x205f;
    if (isSpace) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

export function needsChunking(wordCount: number): boolean {
  return wordCount > CHUNK_TRIGGER_WORDS;
}

/** Number of blocks a text of `wordCount` words will be split into. */
export function estimateSegments(wordCount: number): number {
  if (!needsChunking(wordCount)) return 1;
  return Math.ceil(wordCount / CHUNK_SIZE_WORDS);
}

interface Unit {
  text: string;
  words: number;
}

// Ordered from the most to the least "logical" boundary.
const SPLITTERS: Array<(text: string) => string[]> = [
  (t) => t.split(/(?<=\n[ \t]*\n)/), // paragraphs (keeps the blank line with the preceding paragraph)
  (t) => t.split(/(?<=\n)/), // lines
  (t) => t.split(/(?<=[.!?…]["')\]]?\s)/), // sentences
];

function hardSplitByWords(text: string, maxWords: number): Unit[] {
  const tokens = text.match(/\S+\s*/g) ?? [];
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const units: Unit[] = [];
  for (let i = 0; i < tokens.length; i += maxWords) {
    const slice = tokens.slice(i, i + maxWords);
    units.push({ text: (i === 0 ? leading : "") + slice.join(""), words: slice.length });
  }
  return units;
}

function toUnits(text: string, maxWords: number, level = 0): Unit[] {
  const words = countWords(text);
  if (words <= maxWords) return [{ text, words }];
  if (level >= SPLITTERS.length) return hardSplitByWords(text, maxWords);

  const parts = SPLITTERS[level](text).filter((p) => p.length > 0);
  if (parts.length <= 1) return toUnits(text, maxWords, level + 1);

  const units: Unit[] = [];
  for (const part of parts) {
    const partWords = countWords(part);
    if (partWords <= maxWords) {
      units.push({ text: part, words: partWords });
    } else {
      units.push(...toUnits(part, maxWords, level + 1));
    }
  }
  return units;
}

/**
 * Split `text` into chronological chunks. Returns a single chunk when the text
 * does not exceed the chunking trigger.
 */
export function chunkText(
  text: string,
  options: { triggerWords?: number; maxWords?: number } = {},
): TextChunk[] {
  const triggerWords = options.triggerWords ?? CHUNK_TRIGGER_WORDS;
  const maxWords = options.maxWords ?? CHUNK_SIZE_WORDS;
  const total = countWords(text);

  if (total <= triggerWords) {
    return [{ index: 0, text: text.trim(), wordCount: total, startWord: total ? 1 : 0, endWord: total }];
  }

  // Balance the blocks: e.g. 16,050 words -> 3 blocks of ~5,350 rather than 8,000 + 8,000 + 50.
  const blockCount = Math.ceil(total / maxWords);
  const target = Math.ceil(total / blockCount);
  // Units never exceed the balanced target, so even an unpunctuated wall of text splits evenly.
  const units = toUnits(text, target);

  const chunks: TextChunk[] = [];
  let buffer = "";
  let bufferWords = 0;
  let consumed = 0;

  const flush = () => {
    if (bufferWords === 0) return;
    chunks.push({
      index: chunks.length,
      text: buffer.trim(),
      wordCount: bufferWords,
      startWord: consumed + 1,
      endWord: consumed + bufferWords,
    });
    consumed += bufferWords;
    buffer = "";
    bufferWords = 0;
  };

  for (const unit of units) {
    if (bufferWords > 0 && bufferWords + unit.words > maxWords) flush();
    buffer += unit.text;
    bufferWords += unit.words;
    if (bufferWords >= target) flush();
  }
  flush();

  return chunks;
}
