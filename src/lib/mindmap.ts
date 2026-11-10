/**
 * Mermaid mindmap utilities.
 *
 * LLM-written mindmaps frequently break Mermaid's indentation-sensitive parser
 * (stray parentheses in labels, LaTeX, multiple roots, inconsistent indents,
 * code fences). We parse whatever the model produced into a tree, then
 * re-emit clean, canonical syntax. Works identically on server and client.
 */

import { latexToPlainText } from "./math";

export interface MindNode {
  label: string;
  children: MindNode[];
}

const MAX_NODES = 180;
const MAX_DEPTH = 5;
const MAX_LABEL = 64;
const MAX_ROOT_LABEL = 40;

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */

export function cleanLabel(raw: string, max = MAX_LABEL): string {
  let s = latexToPlainText(raw);
  s = s
    .replace(/\*\*|__|[*`"]/g, "")
    .replace(/->|=>/g, "→")
    .replace(/<-/g, "←")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    // Mermaid treats ASCII brackets as shape delimiters; use look-alike glyphs.
    .replace(/[([{]/g, "⟮")
    .replace(/[)\]}]/g, "⟯")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/:{2,}/g, ":")
    .replace(/[\\]/g, "")
    .replace(/^[%#;:,.\-–—\s]+/, "")
    .replace(/[:;,\-–—\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return s;
}

const SHAPE = /^([A-Za-z0-9_-]*)(\(\(|\)\)|\{\{|\(|\)|\[|\{)([\s\S]*?)(\)\)|\(\(|\}\}|\)|\(|\]|\})$/;

function extractLabel(line: string): string {
  let s = line
    .replace(/\s*::icon\([^)]*\)\s*/g, " ")
    .replace(/\s*:::\s*[\w\s-]+$/, "")
    .trim();
  s = s.replace(/^(?:[-*+•▪◦]|\d+[.)])\s+/, "");
  const shape = s.match(SHAPE);
  if (shape && shape[3].trim()) s = shape[3];
  s = s.trim().replace(/^["'`]+|["'`]+$/g, "");
  return s;
}

/* -------------------------------------------------------------------------- */
/* Parse                                                                      */
/* -------------------------------------------------------------------------- */

export function parseMindmap(code: string | null | undefined): MindNode | null {
  if (!code || !code.trim()) return null;
  const text = code.replace(/\r\n?/g, "\n").replace(/```(?:mermaid)?/gi, "");
  const lines = text.split("\n");

  const headerIdx = lines.findIndex((l) => /^\s*mindmap\b/i.test(l));
  let body: string[];
  if (headerIdx >= 0) {
    body = lines.slice(headerIdx + 1);
    const inline = lines[headerIdx].replace(/^\s*mindmap\b/i, "").trim();
    if (inline) body.unshift(inline);
  } else {
    // A flowchart or other diagram is not something we can coerce into a tree.
    if (/^\s*(graph|flowchart|sequenceDiagram|classDiagram)\b/im.test(text) || /-->|==>|-\.->/.test(text)) return null;
    body = lines;
  }

  const items: Array<{ indent: number; label: string }> = [];
  for (const raw of body) {
    const expanded = raw.replace(/\t/g, "    ");
    const trimmed = expanded.trim();
    if (!trimmed || trimmed.startsWith("%%") || /^::icon|^:::/.test(trimmed)) continue;
    if (/^(?:title|accTitle|accDescr)\b/i.test(trimmed)) continue;
    const label = extractLabel(trimmed);
    if (!label) continue;
    items.push({ indent: expanded.length - expanded.trimStart().length, label });
  }
  if (items.length === 0) return null;

  const root: MindNode = { label: items[0].label, children: [] };
  const rootIndent = items[0].indent;
  const stack: Array<{ indent: number; node: MindNode }> = [];

  for (const item of items.slice(1)) {
    // Extra "roots" (same indent as the root) become first-level branches.
    const indent = Math.max(item.indent, rootIndent + 1);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].node : root;
    const node: MindNode = { label: item.label, children: [] };
    parent.children.push(node);
    stack.push({ indent, node });
  }
  return root;
}

export function countNodes(node: MindNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

/* -------------------------------------------------------------------------- */
/* Emit                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Emit canonical Mermaid mindmap syntax. When the tree is larger than the node
 * budget, nodes are kept breadth-first so every branch stays visible.
 */
export function emitMindmap(root: MindNode, budget = MAX_NODES): string {
  const keep = new Set<MindNode>();
  const queue: Array<{ node: MindNode; depth: number }> = root.children.map((node) => ({ node, depth: 1 }));
  while (queue.length && keep.size < budget) {
    const { node, depth } = queue.shift()!;
    if (!cleanLabel(node.label)) continue;
    keep.add(node);
    if (depth < MAX_DEPTH) queue.push(...node.children.map((child) => ({ node: child, depth: depth + 1 })));
  }

  const rootLabel = cleanLabel(root.label, MAX_ROOT_LABEL) || "Study Suite";
  const lines = ["mindmap", `  root((${rootLabel}))`];
  let id = 0;

  const walk = (node: MindNode, depth: number) => {
    for (const child of node.children) {
      if (!keep.has(child)) continue;
      id++;
      const pad = "  ".repeat(depth + 1);
      const label = cleanLabel(child.label);
      // First-level branches get a rounded shape; deeper levels use Mermaid's default shape.
      lines.push(depth === 1 ? `${pad}b${id}(${label})` : `${pad}n${id}[${label}]`);
      walk(child, depth + 1);
    }
  };
  walk(root, 1);
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Fallback: derive a map from the notes' structure                           */
/* -------------------------------------------------------------------------- */

export function mindmapTreeFromMarkdown(markdown: string, rootLabel: string): MindNode | null {
  if (!markdown) return null;
  const entries: Array<{ kind: "h"; level: number; label: string } | { kind: "b"; indent: number; label: string }> = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      entries.push({ kind: "h", level: heading[1].length, label: heading[2] });
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+\*\*(.+?)\*\*/);
    if (bullet && bullet[1].replace(/\t/g, "  ").length <= 2) {
      entries.push({ kind: "b", indent: bullet[1].length, label: bullet[2].replace(/[:：]$/, "") });
    }
  }

  const headingLevels = [...new Set(entries.filter((e) => e.kind === "h").map((e) => (e as { level: number }).level))].sort();
  const depthOf = (e: (typeof entries)[number]) =>
    e.kind === "h" ? headingLevels.indexOf(e.level) + 1 : headingLevels.length + 1 + (e.indent > 0 ? 1 : 0);

  const root: MindNode = { label: rootLabel, children: [] };
  const stack: Array<{ depth: number; node: MindNode }> = [];
  for (const entry of entries) {
    const depth = depthOf(entry);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].node : root;
    const node: MindNode = { label: entry.label, children: [] };
    parent.children.push(node);
    stack.push({ depth, node });
  }

  // Collapse a single generic wrapper heading (e.g. "# Concept Architecture").
  while (root.children.length === 1 && root.children[0].children.length > 1) {
    root.children = root.children[0].children;
  }
  return countNodes(root) >= 3 ? root : null;
}

/* -------------------------------------------------------------------------- */
/* Public helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Return clean Mermaid mindmap code. Falls back to a map derived from the
 * notes when the model's map is missing or unusably small. Returns null only
 * when nothing usable exists.
 */
export function sanitizeMindmap(code: string, fallbackTitle: string, notes?: string): string | null {
  const tree = parseMindmap(code);
  if (tree && countNodes(tree) >= 3) return emitMindmap(tree);
  const derived = notes ? mindmapTreeFromMarkdown(notes, tree?.label || fallbackTitle) : null;
  if (derived) return emitMindmap(derived);
  return tree ? emitMindmap(tree) : null;
}

export function mindmapRootLabel(code: string): string | null {
  const tree = parseMindmap(code);
  return tree ? cleanLabel(tree.label, MAX_ROOT_LABEL) || null : null;
}

/** Merge per-segment mind maps under one root, one branch per segment. */
export function mergeMindmaps(rootLabel: string, parts: Array<{ code: string; fallbackLabel: string }>): string {
  const root: MindNode = { label: rootLabel, children: [] };
  parts.forEach((part, i) => {
    const tree = parseMindmap(part.code);
    root.children.push({
      label: `Part ${i + 1} · ${tree?.label ?? part.fallbackLabel}`,
      children: tree?.children ?? [],
    });
  });
  return emitMindmap(root, Math.max(MAX_NODES, parts.length * 24));
}
