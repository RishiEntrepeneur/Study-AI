import "server-only";

import type { NewMaterial, NewProject } from "./data/projects";
import { BadRequestError } from "./ai/http";
import { isOutputType } from "./outputs";
import { countWords } from "./text/chunking";
import type { OutputType } from "./types";

const MAX_MATERIALS = 20;

function str(value: unknown, max: number, label: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequestError(`${label} must be text.`);
  const trimmed = value.replace(/\u0000/g, "").trim();
  if (trimmed.length > max) throw new BadRequestError(`${label} is too long (max ${max} characters).`);
  return trimmed;
}

export function parseOutputs(value: unknown): OutputType[] {
  if (!Array.isArray(value) || value.length === 0) throw new BadRequestError("Choose at least one thing to create.");
  const outputs = [...new Set(value)].filter(isOutputType);
  if (outputs.length !== new Set(value).size) throw new BadRequestError("One of the selected outputs isn't recognised.");
  return outputs;
}

export function parseMaterials(value: unknown, maxWords: number): NewMaterial[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestError("Materials must be a list.");
  if (value.length > MAX_MATERIALS) throw new BadRequestError(`Add at most ${MAX_MATERIALS} materials at a time.`);
  const materials: NewMaterial[] = [];
  let words = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null) throw new BadRequestError("Each material must be an object.");
    const { kind, name, content } = item as Record<string, unknown>;
    const k = kind === "file" || kind === "recording" ? kind : "text";
    const text = typeof content === "string" ? content.replace(/\u0000/g, "").trim() : "";
    if (!text) continue;
    words += countWords(text);
    materials.push({ kind: k, name: str(name, 200, "Material name") || (k === "file" ? "Uploaded file" : k === "recording" ? "Lecture recording" : "Pasted text"), content: text });
  }
  if (words > maxWords) {
    throw new BadRequestError(
      `That's ${words.toLocaleString("en-US")} words. The limit is ${maxWords.toLocaleString("en-US")} words per project, so please split it into separate projects.`,
    );
  }
  return materials;
}

export function parseNewProject(body: unknown, maxWords: number): NewProject {
  if (typeof body !== "object" || body === null) throw new BadRequestError("Request body must be a JSON object.");
  const b = body as Record<string, unknown>;
  const topic = str(b.topic, 500, "Topic");
  const materials = parseMaterials(b.materials, maxWords);
  const outputs = parseOutputs(b.outputs);
  const tier = b.tier === "deep_dive" ? "deep_dive" : "standard";
  const folderId = typeof b.folderId === "string" && b.folderId ? b.folderId : null;

  const materialWords = materials.reduce((s, m) => s + countWords(m.content), 0);
  if (!topic && materialWords === 0) {
    throw new BadRequestError("Type a topic you want to learn, or add some material (paste text or upload a file).");
  }
  if (!topic && materialWords < 20) {
    throw new BadRequestError("Add a topic, or at least 20 words of material, so there's something to study.");
  }

  const fallbackTitle = topic || materials[0]?.name.replace(/\.[a-z0-9]+$/i, "") || "Untitled project";
  const title = str(b.title, 120, "Title") || (fallbackTitle.length > 80 ? `${fallbackTitle.slice(0, 77)}…` : fallbackTitle);

  return { title, topic, tier, folderId, materials, outputs };
}
