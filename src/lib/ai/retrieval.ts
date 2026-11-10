/**
 * Lightweight passage retrieval (BM25) so the tutor can ground answers in
 * long materials without needing an embedding model.
 */

export interface Passage {
  source: string;
  text: string;
}

const STOPWORDS = new Set(
  "a an and are as at be but by can do does for from has have how i if in into is it its me my of on or our so than that the their them then there these they this to was we what when where which who why will with you your".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").match(/[\p{Letter}\p{Number}]+/gu) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

/** Split text into passages of roughly `size` words, breaking on paragraphs where possible. */
export function splitPassages(source: string, text: string, size = 220): Passage[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const passages: Passage[] = [];
  let current: string[] = [];
  let words = 0;
  const flush = () => {
    if (current.length) passages.push({ source, text: current.join("\n\n") });
    current = [];
    words = 0;
  };
  for (const paragraph of paragraphs) {
    const pw = paragraph.split(/\s+/);
    if (pw.length > size * 1.5) {
      flush();
      for (let i = 0; i < pw.length; i += size) passages.push({ source, text: pw.slice(i, i + size).join(" ") });
      continue;
    }
    if (words + pw.length > size) flush();
    current.push(paragraph);
    words += pw.length;
  }
  flush();
  return passages;
}

/** Rank passages against a query with BM25 and return the best ones, in original order. */
export function rankPassages(passages: Passage[], query: string, maxWords: number): Passage[] {
  if (!passages.length) return [];
  const qTerms = [...new Set(tokenize(query))];
  const docs = passages.map((p) => tokenize(p.text));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);

  const k1 = 1.4;
  const b = 0.75;
  const N = docs.length;
  const scores = docs.map((d, i) => {
    if (!qTerms.length) return { i, score: 0 };
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of qTerms) {
      const f = tf.get(q) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(q) ?? 0) + 0.5) / ((df.get(q) ?? 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen)));
    }
    return { i, score };
  });

  // Best passages first; ties (e.g. an empty query) keep document order.
  scores.sort((x, y) => y.score - x.score || x.i - y.i);
  const chosen: number[] = [];
  let used = 0;
  for (const { i } of scores) {
    const w = passages[i].text.split(/\s+/).length;
    if (used + w > maxWords && chosen.length) continue;
    chosen.push(i);
    used += w;
    if (used >= maxWords) break;
  }
  return chosen.sort((a, b2) => a - b2).map((i) => passages[i]);
}
