"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, ListTree, Pause, Pencil, Play, Square, Volume2 } from "lucide-react";
import { saveMarkdown } from "../actions/library";
import { latexToPlainText } from "@/lib/math";
import { GenerateButton } from "./OutputGate";
import MathMarkdown from "./MathMarkdown";
import Spinner from "./Spinner";

interface Props {
  projectId: string;
  type: "notes" | "cheatsheet";
  title: string;
  markdown: string;
}

interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

/** Heading text without KaTeX's hidden MathML duplicate. */
function headingText(heading: HTMLElement): string {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".katex-mathml").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Markdown → speakable sentences. */
function toSpeech(markdown: string): string[] {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => ` ${latexToPlainText(tex)} `)
    .replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => latexToPlainText(tex))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/^-{3,}$/gm, "");
  return text
    .split(/\n\s*\n|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 1);
}

const noopSubscribe = () => () => {};

function slugFile(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "study-notes";
}

export default function NotesView({ projectId, type, title, markdown }: Props) {
  const router = useRouter();
  const articleRef = useRef<HTMLElement>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(markdown);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [speech, setSpeech] = useState<"idle" | "playing" | "paused">("idle");
  const speechSupported = useSyncExternalStore(
    noopSubscribe,
    () => "speechSynthesis" in window,
    () => false,
  );
  const label = type === "notes" ? "notes" : "cheat sheet";

  useEffect(() => {
    const article = articleRef.current;
    if (!article || editing) return;
    const headings = Array.from(article.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]"));
    setOutline(headings.map((h) => ({ id: h.id, text: headingText(h), level: Number(h.tagName[1]) })));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [markdown, editing]);

  // Stop reading aloud when leaving the page.
  useEffect(() => () => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const listen = () => {
    const synth = window.speechSynthesis;
    if (speech === "playing") {
      synth.pause();
      setSpeech("paused");
      return;
    }
    if (speech === "paused") {
      synth.resume();
      setSpeech("playing");
      return;
    }
    synth.cancel();
    const sentences = toSpeech(markdown);
    // Queue sentence by sentence: long single utterances get cut off in some browsers.
    sentences.forEach((sentence, i) => {
      const u = new SpeechSynthesisUtterance(sentence);
      u.rate = 1;
      if (i === sentences.length - 1) u.onend = () => setSpeech("idle");
      u.onerror = () => setSpeech("idle");
      synth.speak(u);
    });
    setSpeech(sentences.length ? "playing" : "idle");
  };

  const stopListening = () => {
    window.speechSynthesis.cancel();
    setSpeech("idle");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: `${slugFile(title)}-${type}.md` }).click();
    URL.revokeObjectURL(url);
  };

  const save = () =>
    startSave(async () => {
      setSaveError(null);
      const res = await saveMarkdown(projectId, type, draft);
      if (!res.ok) return setSaveError(res.error ?? "Couldn't save.");
      setEditing(false);
      router.refresh();
    });

  if (editing) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            Editing in Markdown. Use <code className="rounded bg-subtle px-1">$...$</code> for math.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving} className="btn btn-primary btn-sm">
              {saving ? <Spinner /> : <Check className="size-3.5" />} Save
            </button>
          </div>
        </div>
        {saveError && <p className="text-sm text-bad">{saveError}</p>}
        <textarea
          aria-label={`Edit ${label}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="field min-h-[70vh] font-mono text-[13px] leading-relaxed"
          spellCheck
        />
      </div>
    );
  }

  return (
    <div className={`grid gap-8 ${outline.length > 2 && type === "notes" ? "lg:grid-cols-[minmax(0,1fr)_14rem]" : ""}`}>
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(markdown);
              setEditing(true);
            }}
            className="btn btn-secondary btn-sm"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
          {speechSupported && (
            <>
              <button type="button" onClick={listen} className="btn btn-secondary btn-sm" aria-pressed={speech === "playing"}>
                {speech === "playing" ? <Pause className="size-3.5" /> : speech === "paused" ? <Play className="size-3.5" /> : <Volume2 className="size-3.5" />}
                {speech === "playing" ? "Pause" : speech === "paused" ? "Resume" : "Listen"}
              </button>
              {speech !== "idle" && (
                <button type="button" onClick={stopListening} className="icon-btn" aria-label="Stop reading">
                  <Square className="size-3.5" />
                </button>
              )}
            </>
          )}
          <button type="button" onClick={copy} className="btn btn-ghost btn-sm">
            {copied ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={download} className="btn btn-ghost btn-sm">
            <Download className="size-3.5" /> Download
          </button>
          <span className="ml-auto">
            <GenerateButton type={type} label="Regenerate" variant="secondary" confirmText="Replace these with a new version? Your edits will be lost." />
          </span>
        </div>
        <article
          ref={articleRef}
          className="card px-5 py-6 sm:px-10 sm:py-9"
        >
          <MathMarkdown
            className={`prose max-w-none font-serif text-[17px] leading-[1.75] dark:prose-invert prose-headings:scroll-mt-24 prose-headings:font-sans prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-[1.7rem] prose-h2:mt-10 prose-h2:border-b prose-h2:border-line prose-h2:pb-1.5 prose-h2:text-[1.3rem] prose-h3:text-lg prose-a:text-accent prose-strong:text-ink prose-code:rounded prose-code:bg-subtle prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-blockquote:border-l-accent prose-li:my-1 prose-li:marker:text-faint prose-hr:border-line ${
              type === "cheatsheet" ? "text-[15px] leading-relaxed prose-h2:mt-7 prose-li:my-0.5" : ""
            }`}
          >
            {markdown}
          </MathMarkdown>
        </article>
      </div>

      {outline.length > 2 && type === "notes" && (
        <nav aria-label="Outline" className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">
            <p className="eyebrow mb-2 flex items-center gap-1.5">
              <ListTree className="size-3.5" /> On this page
            </p>
            <ul className="space-y-0.5 border-l border-line text-sm">
              {outline.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      setActiveId(item.id);
                    }}
                    style={{ paddingLeft: `${(item.level - 1) * 0.7 + 0.75}rem` }}
                    className={`-ml-px block truncate border-l py-1 pr-2 transition-colors ${
                      activeId === item.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
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
