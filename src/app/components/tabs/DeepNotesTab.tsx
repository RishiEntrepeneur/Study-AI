"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, ListTree } from "lucide-react";
import MathMarkdown from "../MathMarkdown";

interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

export default function DeepNotesTab({ notes, title }: { notes: string; title: string }) {
  const articleRef = useRef<HTMLElement>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Build the outline from the rendered headings (ids come from the rehype plugin).
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const headings = Array.from(article.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]"));
    const items = headings.map((h) => ({
      id: h.id,
      text: headingText(h),
      level: Number(h.tagName[1]),
    }));
    setOutline(items);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-90px 0px -65% 0px" },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [notes]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(notes);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  const download = () => {
    const blob = new Blob([`# ${title}\n\n${notes}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `${slugFile(title)}-notes.md` });
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!notes.trim()) {
    return <p className="py-16 text-center text-zinc-400">The AI did not return notes for this material.</p>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="glass rounded-3xl p-5 sm:p-8 lg:p-10">
        <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={copy} className="toolbar-btn">
            {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy Markdown"}
          </button>
          <button type="button" onClick={download} className="toolbar-btn">
            <Download className="size-4" /> Download .md
          </button>
        </div>
        <article
          ref={articleRef}
          className="prose prose-invert prose-zinc max-w-none prose-headings:scroll-mt-28 prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-3xl prose-h1:bg-gradient-to-r prose-h1:from-violet-200 prose-h1:via-fuchsia-200 prose-h1:to-cyan-200 prose-h1:bg-clip-text prose-h1:text-transparent prose-h2:mt-12 prose-h2:border-b prose-h2:border-white/10 prose-h2:pb-2 prose-h2:text-violet-100 prose-h3:text-cyan-100 prose-p:leading-relaxed prose-a:text-cyan-300 prose-strong:text-white prose-em:text-violet-200 prose-code:rounded prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none prose-blockquote:border-l-violet-400/60 prose-blockquote:text-zinc-400 prose-li:my-1.5 prose-li:marker:text-violet-400 prose-hr:my-12 prose-hr:border-white/10"
        >
          <MathMarkdown>{notes}</MathMarkdown>
        </article>
      </div>

      {outline.length > 1 && (
        <nav aria-label="Notes outline" className="hidden lg:block">
          <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-zinc-400 uppercase">
              <ListTree className="size-3.5" /> Outline
            </p>
            <ul className="space-y-1 text-sm">
              {outline.map((item) => (
                <li key={item.id} style={{ paddingLeft: `${(item.level - 1) * 0.75}rem` }}>
                  <a
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      setActiveId(item.id);
                    }}
                    className={`block truncate rounded-md px-2 py-1 transition ${
                      activeId === item.id ? "bg-violet-500/15 text-violet-100" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      )}
    </div>
  );
}

/** Heading text without KaTeX's hidden MathML duplicate. */
function headingText(heading: HTMLElement): string {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".katex-mathml").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function slugFile(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "study-suite";
}
