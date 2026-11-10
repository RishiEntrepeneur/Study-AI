/**
 * Browser-side text extraction for dropped files. Heavy parsers (PDF, DOCX)
 * are loaded lazily, only when such a file is actually dropped.
 */

import { countWords } from "../text/chunking";

export type SourceKind = "pdf" | "docx" | "transcript" | "html" | "text";

export interface ExtractedSource {
  id: string;
  name: string;
  kind: SourceKind;
  text: string;
  words: number;
}

export const ACCEPTED_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".srt", ".vtt", ".sbv", ".csv", ".tsv", ".json", ".html", ".htm", ".xml", ".tex", ".rtf", ".log",
  ".pdf", ".docx",
];

export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_EXTENSIONS,
  "text/*",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** Strip cue numbers, timestamps and caption markup from SRT / VTT / SBV transcripts. */
export function cleanTranscript(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let skipBlock = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      skipBlock = false;
      continue;
    }
    if (skipBlock) continue;
    if (/^WEBVTT/i.test(t) || /^(Kind|Language):/i.test(t)) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(t)) {
      skipBlock = true;
      continue;
    }
    if (/^\d+$/.test(t)) continue; // cue index
    if (/-->/.test(t) || /^\d{1,2}:\d{2}:\d{2}[.,]\d{3},\d{1,2}:\d{2}:\d{2}[.,]\d{3}$/.test(t)) continue; // timings
    const text = t
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]*\}/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .trim();
    if (!text || out[out.length - 1] === text) continue; // rolling-caption duplicates
    out.push(text);
  }
  return out.join("\n");
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, template").forEach((el) => el.remove());
  doc.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, br, tr").forEach((el) => el.append("\n"));
  return (doc.body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function jsonToText(raw: string): string {
  try {
    const data: unknown = JSON.parse(raw);
    // Common transcript exports: [{ text }, ...] or { segments: [{ text }] }
    const items = Array.isArray(data)
      ? data
      : (data as { segments?: unknown[]; transcript?: unknown[] }).segments ??
        (data as { transcript?: unknown[] }).transcript;
    if (Array.isArray(items) && items.every((i) => typeof i === "object" && i && "text" in i)) {
      return items.map((i) => String((i as { text: unknown }).text)).join(" ");
    }
  } catch {
    /* fall through to raw text */
  }
  return raw;
}

async function pdfToText(file: File): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((page) => page.trim()).filter(Boolean).join("\n\n");
}

async function docxToText(file: File): Promise<string> {
  const mammoth = (await import("mammoth/mammoth.browser.min.js")).default;
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

export async function extractFile(file: File): Promise<ExtractedSource> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 50 MB.`);
  const ext = extensionOf(file.name);
  let kind: SourceKind = "text";
  let text: string;

  if (ext === ".pdf" || file.type === "application/pdf") {
    kind = "pdf";
    text = await pdfToText(file);
  } else if (ext === ".docx") {
    kind = "docx";
    text = await docxToText(file);
  } else if (ext === ".srt" || ext === ".vtt" || ext === ".sbv") {
    kind = "transcript";
    text = cleanTranscript(await file.text());
  } else if (ext === ".html" || ext === ".htm") {
    kind = "html";
    text = htmlToText(await file.text());
  } else if (ext === ".json") {
    text = jsonToText(await file.text());
  } else if (ACCEPTED_EXTENSIONS.includes(ext) || file.type.startsWith("text/") || !ext) {
    text = await file.text();
  } else {
    throw new Error(`${file.name}: unsupported file type. Try PDF, DOCX, TXT, MD, SRT or VTT.`);
  }

  text = text.replace(/\u0000/g, "").trim();
  if (!text) {
    throw new Error(
      kind === "pdf"
        ? `${file.name} has no selectable text (it may be a scanned PDF).`
        : `${file.name} appears to be empty.`,
    );
  }

  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    kind,
    text,
    words: countWords(text),
  };
}
