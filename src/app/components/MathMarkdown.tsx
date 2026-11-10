"use client";

import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Element, ElementContent, Root } from "hast";
import type { PluggableList } from "unified";
import { Cog, EyeOff, FlaskConical, Lightbulb, type LucideIcon } from "lucide-react";
import { normalizeMath } from "@/lib/math";

/* ------------------------------------------------------------------ */
/* rehype plugin: stable, unique ids on headings (for the outline)     */
/* ------------------------------------------------------------------ */

function textOf(node: ElementContent | Element): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") {
    // KaTeX renders MathML + HTML twice; read the annotation-free HTML half only.
    if (node.properties?.className && String(node.properties.className).includes("katex-mathml")) return "";
    return node.children.map(textOf).join("");
  }
  return "";
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 64) || "section"
  );
}

function rehypeHeadingIds() {
  return (tree: Root) => {
    const seen = new Map<string, number>();
    const walk = (children: Root["children"] | ElementContent[]) => {
      for (const child of children) {
        if (child.type !== "element") continue;
        if (/^h[1-4]$/.test(child.tagName)) {
          const base = slugify(textOf(child));
          const n = seen.get(base) ?? 0;
          seen.set(base, n + 1);
          child.properties = { ...child.properties, id: n ? `${base}-${n}` : base };
        }
        walk(child.children);
      }
    };
    walk(tree.children);
  };
}

/* ------------------------------------------------------------------ */
/* Concept-pattern badges (*Mechanics*, *Analogy*, *Blind Spot*)      */
/* ------------------------------------------------------------------ */

const BADGES: Record<string, { icon: LucideIcon; className: string }> = {
  mechanics: { icon: Cog, className: "border-accent/30 bg-accent-soft text-accent" },
  analogy: { icon: Lightbulb, className: "border-warn/30 bg-warn-soft text-warn" },
  "blind spot": { icon: EyeOff, className: "border-bad/30 bg-bad-soft text-bad" },
  derivation: { icon: FlaskConical, className: "border-good/30 bg-good-soft text-good" },
  example: { icon: FlaskConical, className: "border-good/30 bg-good-soft text-good" },
};

function plainText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(plainText).join("");
  return "";
}

const blockComponents: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  em: ({ children }) => {
    const key = plainText(children).trim().replace(/:$/, "").toLowerCase();
    const badge = BADGES[key];
    if (!badge) return <em>{children}</em>;
    const Icon = badge.icon;
    return (
      <span
        className={`not-prose mr-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded border px-1.5 py-px align-middle font-sans text-[0.68rem] font-semibold tracking-wide not-italic uppercase ${badge.className}`}
      >
        <Icon className="size-3" aria-hidden />
        {children}
      </span>
    );
  },
  table: ({ children }) => (
    <div className="not-prose my-5 overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-left font-sans text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_th]:bg-subtle [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold">
        {children}
      </table>
    </div>
  ),
};

const inlineComponents: Components = {
  ...blockComponents,
  p: ({ children }) => <span>{children}</span>,
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: PluggableList = [
  [rehypeKatex, { throwOnError: false, strict: "ignore", errorColor: "#fda4af" }],
  rehypeHeadingIds,
];

interface MathMarkdownProps {
  children: string;
  className?: string;
  /** Render paragraphs as spans (for buttons and compact labels). */
  inline?: boolean;
}

function MathMarkdownImpl({ children, className, inline = false }: MathMarkdownProps) {
  const content = (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={inline ? inlineComponents : blockComponents}
    >
      {normalizeMath(children)}
    </ReactMarkdown>
  );
  return inline ? <span className={className}>{content}</span> : <div className={className}>{content}</div>;
}

export const MathMarkdown = memo(MathMarkdownImpl);
export default MathMarkdown;
