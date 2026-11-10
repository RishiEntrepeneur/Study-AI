"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Brain,
  Clock,
  Cpu,
  FileJson,
  FileText,
  History,
  Layers,
  Network,
  PenLine,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Target,
  Telescope,
  TriangleAlert,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { ContextTier, Flashcard, PipelineEvent, QuizQuestion, StudySuiteResponse, SuiteMeta } from "@/lib/types";
import type { ExtractedSource } from "@/lib/client/extract";
import { generateStudySuite, GenerateError } from "@/lib/client/generate";
import { clearLastSuite, loadLastSuite, saveLastSuite } from "@/lib/client/storage";
import { downloadFile, suiteToMarkdown } from "@/lib/client/exportSuite";
import { countWords, estimateSegments, CHUNK_TRIGGER_WORDS } from "@/lib/text/chunking";

import SourceDropZone from "./SourceDropZone";
import TierToggle from "./TierToggle";
import ProcessingSteps, { type ProgressState } from "./ProcessingSteps";
import StatusPill from "./StatusPill";
import DeepNotesTab, { slugFile } from "./tabs/DeepNotesTab";
import FlashcardsTab from "./tabs/FlashcardsTab";
import QuizTab from "./tabs/QuizTab";
import MindMapTab, { loadMermaid } from "./tabs/MindMapTab";

type Phase = "idle" | "processing" | "ready" | "error";
type TabId = "notes" | "flashcards" | "quiz" | "mindmap";

const MIN_WORDS = 20;

const TABS: Array<{ id: TabId; label: string; short: string; icon: LucideIcon }> = [
  { id: "notes", label: "Deep Notes", short: "Notes", icon: BookOpen },
  { id: "flashcards", label: "Flashcards", short: "Cards", icon: Layers },
  { id: "quiz", label: "Interactive Quiz", short: "Quiz", icon: Target },
  { id: "mindmap", label: "Visual Mind Map", short: "Map", icon: Network },
];

const FEATURES: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: BookOpen, title: "Deep Notes", body: "Concept architecture with mechanics, analogies, blind spots and crisp LaTeX math." },
  { icon: Layers, title: "Flashcards", body: "Active-recall cards with a smooth 3D flip and memory hints." },
  { icon: Target, title: "Interactive Quiz", body: "Application questions with instant feedback and explanations." },
  { icon: Network, title: "Mind Map", body: "An interactive visual map of how every concept connects." },
];

function reduceProgress(p: ProgressState, event: PipelineEvent): ProgressState {
  switch (event.type) {
    case "plan":
      return { ...p, planned: true, wordCount: event.wordCount, segments: event.segments };
    case "segment_start":
      return { ...p, step: 2, segmentIndex: event.index, segments: event.total, tokens: 0 };
    case "segment_progress":
      return { ...p, step: 2, segmentIndex: event.index, tokens: event.tokens };
    case "segment_done":
      return { ...p, segmentIndex: Math.min(event.index + 1, event.total - 1), tokens: event.index + 1 < event.total ? 0 : p.tokens };
    case "synthesis_start":
      return { ...p, synthesizing: true };
    default:
      return p;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function Dashboard() {
  /* ---------------- input ---------------- */
  const [sources, setSources] = useState<ExtractedSource[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [tier, setTier] = useState<ContextTier>("standard");

  /* ---------------- pipeline ---------------- */
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<{ message: string; status: number; code?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ---------------- structured results: one state per JSON property ---------------- */
  const [deepNotes, setDeepNotes] = useState("");
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [mindMapCode, setMindMapCode] = useState("");
  const [meta, setMeta] = useState<SuiteMeta | null>(null);

  /* ---------------- ui ---------------- */
  const [activeTab, setActiveTab] = useState<TabId>("notes");
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set<TabId>(["notes"]));
  const [savedSuite, setSavedSuite] = useState<StudySuiteResponse | null>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ notes: null, flashcards: null, quiz: null, mindmap: null });
  const panelsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    setSavedSuite(loadLastSuite());
    return () => abortRef.current?.abort();
  }, []);

  const combinedText = useMemo(() => {
    const parts = [
      ...sources.map((s) => ({ label: s.name, text: s.text })),
      ...(pastedText.trim() ? [{ label: "Pasted text", text: pastedText.trim() }] : []),
    ];
    if (parts.length <= 1) return parts[0]?.text ?? "";
    return parts.map((p) => `## Source: ${p.label}\n\n${p.text}`).join("\n\n");
  }, [sources, pastedText]);

  const wordCount = useMemo(() => countWords(combinedText), [combinedText]);
  const plannedSegments = estimateSegments(wordCount);
  const canGenerate = wordCount >= MIN_WORDS && phase !== "processing";

  const routeSuite = useCallback((suite: StudySuiteResponse) => {
    setDeepNotes(suite.deepNotes);
    setFlashcards(suite.flashcards);
    setQuiz(suite.quiz);
    setMindMapCode(suite.mindMapCode);
    setMeta(suite.meta);
    setActiveTab("notes");
    setVisited(new Set<TabId>(["notes"]));
  }, []);

  const generate = async () => {
    if (!canGenerate) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setPhase("processing");
    setProgress({
      step: 1,
      tier,
      wordCount,
      segments: plannedSegments,
      planned: false,
      segmentIndex: 0,
      tokens: 0,
      synthesizing: false,
      startedAt: Date.now(),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
      const suite = await generateStudySuite(
        { sourceText: combinedText, contextTier: tier },
        { signal: controller.signal, onEvent: (event) => setProgress((p) => (p ? reduceProgress(p, event) : p)) },
      );
      // Step 3: warm up the renderers before revealing the dashboard.
      setProgress((p) => (p ? { ...p, step: 3, synthesizing: false } : p));
      await Promise.all([loadMermaid().catch(() => null), nextFrame(), delay(900)]);
      if (controller.signal.aborted) return;
      routeSuite(suite);
      saveLastSuite(suite);
      setSavedSuite(suite);
      setPhase("ready");
    } catch (err) {
      if (controller.signal.aborted) return;
      const e = err instanceof GenerateError ? err : new GenerateError("Something went wrong while building your study suite.", 0);
      setError({ message: e.message, status: e.status, code: e.code });
      setPhase("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(null);
    setPhase("idle");
  };

  const goHome = () => {
    if (phase === "processing") return;
    setPhase("idle");
  };

  const resume = () => {
    if (!savedSuite) return;
    routeSuite(savedSuite);
    setPhase("ready");
  };

  const discardSaved = () => {
    clearLastSuite();
    setSavedSuite(null);
  };

  const selectTab = (id: TabId) => {
    setActiveTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    // If the student is deep inside a long panel, bring the new panel's top into view.
    const panels = panelsRef.current;
    if (panels) {
      const top = panels.getBoundingClientRect().top + window.scrollY - 136;
      if (window.scrollY > top) window.scrollTo({ top });
    }
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === activeTab);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === -1) return;
    e.preventDefault();
    selectTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  const currentSuite = (): StudySuiteResponse | null =>
    meta ? { deepNotes, flashcards, quiz, mindMapCode, meta } : null;

  const exportMarkdown = () => {
    const suite = currentSuite();
    if (suite) downloadFile(`${slugFile(suite.meta.title)}-study-suite.md`, suiteToMarkdown(suite), "text/markdown;charset=utf-8");
  };

  const exportJson = () => {
    const suite = currentSuite();
    if (suite) downloadFile(`${slugFile(suite.meta.title)}-study-suite.json`, JSON.stringify(suite, null, 2), "application/json");
  };

  const counts: Partial<Record<TabId, number>> = { flashcards: flashcards.length, quiz: quiz.length };

  return (
    <div className="flex min-h-screen flex-col">
      {/* ================= Header ================= */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-950/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <button type="button" onClick={goHome} className="group flex items-center gap-3 text-left" aria-label="Superpower Study Suite home">
            <span className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 shadow-[0_8px_24px_-6px_rgba(168,85,247,0.7)] transition-transform group-hover:scale-105">
              <Zap className="size-5 text-white" fill="currentColor" />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight text-white sm:text-base">
                Superpower <span className="text-gradient">Study Suite</span>
              </span>
              <span className="hidden text-[11px] text-zinc-500 sm:block">Private-AI lecture intelligence</span>
            </span>
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            <StatusPill />
            {phase === "ready" && (
              <button type="button" onClick={() => setPhase("idle")} className="toolbar-btn">
                <Plus className="size-4" /> <span className="hidden sm:inline">New session</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {/* ================= Idle: input ================= */}
        {phase === "idle" && (
          <div className="animate-fade-up">
            <section className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-200">
                <ShieldCheck className="size-3.5" /> 100% free for students · private AI · no API keys
              </span>
              <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance text-white sm:text-6xl">
                Turn any lecture into a <span className="text-gradient">Master Study Suite</span>
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-base text-pretty text-zinc-400 sm:text-lg">
                Drop a transcript, slides or raw notes. Get exhaustive notes with typeset equations, active-recall flashcards, an
                interactive quiz and a visual mind map, in one pass.
              </p>
            </section>

            {savedSuite && (
              <div className="mx-auto mt-8 flex max-w-3xl flex-col gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4 sm:flex-row sm:items-center">
                <History className="size-5 shrink-0 text-cyan-300" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">Resume “{savedSuite.meta.title}”</p>
                  <p className="text-xs text-zinc-400">
                    Saved on this device · {new Date(savedSuite.meta.generatedAt).toLocaleString()} · {savedSuite.flashcards.length} cards ·{" "}
                    {savedSuite.quiz.length} questions
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={resume} className="toolbar-btn border-cyan-400/30 text-cyan-100">
                    Open <ArrowRight className="size-4" />
                  </button>
                  <button type="button" onClick={discardSaved} className="icon-btn" aria-label="Forget saved suite">
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            )}

            <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
              <section className="glass rounded-3xl p-5 sm:p-7" aria-labelledby="material-heading">
                <h2 id="material-heading" className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-[0.18em] text-zinc-300 uppercase">
                  <span className="grid size-6 place-items-center rounded-md bg-violet-500/20 text-xs text-violet-200">1</span>
                  Lecture material
                </h2>
                <SourceDropZone
                  sources={sources}
                  onSourcesChange={setSources}
                  pastedText={pastedText}
                  onPastedTextChange={setPastedText}
                />
              </section>

              <aside className="glass h-fit rounded-3xl p-5 sm:p-7 lg:sticky lg:top-24" aria-labelledby="controls-heading">
                <h2 id="controls-heading" className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-[0.18em] text-zinc-300 uppercase">
                  <span className="grid size-6 place-items-center rounded-md bg-violet-500/20 text-xs text-violet-200">2</span>
                  Advanced controls
                </h2>
                <p className="mb-3 text-xs font-medium text-zinc-500">Analytical tier</p>
                <TierToggle value={tier} onChange={setTier} />

                <dl className="mt-6 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">Words</dt>
                    <dd className="mt-1 text-xl font-semibold text-white tabular-nums">{wordCount.toLocaleString()}</dd>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">Processing plan</dt>
                    <dd className="mt-1 text-sm font-semibold text-white">
                      {wordCount > CHUNK_TRIGGER_WORDS ? (
                        <span className="text-amber-200">{plannedSegments} segments</span>
                      ) : (
                        "Single pass"
                      )}
                    </dd>
                  </div>
                </dl>
                {wordCount > CHUNK_TRIGGER_WORDS && (
                  <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100/90">
                    Heavy chunking engaged: your material will be split into {plannedSegments} chronological segments of ≤ 8,000 words,
                    analysed in order and synthesised into one suite.
                  </p>
                )}

                <button
                  type="button"
                  onClick={generate}
                  disabled={!canGenerate}
                  className="group relative mt-6 flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 px-5 py-4 text-base font-semibold text-white shadow-[0_18px_40px_-14px_rgba(168,85,247,0.9)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                >
                  <span className="shimmer-bar pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  <Sparkles className="relative size-5" />
                  <span className="relative">Generate Study Suite</span>
                </button>
                <p className="mt-3 text-center text-xs text-zinc-500">
                  {wordCount < MIN_WORDS
                    ? `Add at least ${MIN_WORDS} words of material to begin.`
                    : `${tier === "deep_dive" ? "Deep Dive" : "Standard"} tier · ready to process`}
                </p>

                <div className="mt-6 flex gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-zinc-400">
                  <Server className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                  <p>Runs on a self-hosted AI model. No third-party AI APIs and no keys required, so it&apos;s free for every student.</p>
                </div>
              </aside>
            </div>

            <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="What you get">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                  <Icon className="size-5 text-violet-300" />
                  <h3 className="mt-3 font-semibold text-white">{title}</h3>
                  <p className="mt-1 text-sm text-zinc-400">{body}</p>
                </div>
              ))}
            </section>
          </div>
        )}

        {/* ================= Processing ================= */}
        {phase === "processing" && progress && <ProcessingSteps progress={progress} onCancel={cancel} />}

        {/* ================= Error ================= */}
        {phase === "error" && error && (
          <section className="glass mx-auto max-w-xl rounded-3xl p-8 text-center animate-card-in" role="alert">
            <div
              className={`mx-auto grid size-14 place-items-center rounded-2xl ${
                error.status === 503 ? "bg-amber-400/15 text-amber-300" : "bg-rose-500/15 text-rose-300"
              }`}
            >
              {error.status === 503 ? <Server className="size-7 animate-pulse" /> : <TriangleAlert className="size-7" />}
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-white">
              {error.status === 503 ? "The private AI is warming up" : error.status === 429 ? "Take a short breather" : "We hit a snag"}
            </h2>
            <p className="mt-2 text-zinc-300">{error.message}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={generate}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white"
              >
                <RefreshCw className="size-4" /> Try again
              </button>
              <button type="button" onClick={() => setPhase("idle")} className="toolbar-btn px-4 py-2.5">
                <PenLine className="size-4" /> Edit material
              </button>
            </div>
          </section>
        )}

        {/* ================= Results ================= */}
        {phase === "ready" && meta && (
          <div className="animate-fade-up">
            <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-violet-300 uppercase">
                  <Brain className="size-4" /> Your Master Study Suite
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl">{meta.title}</h1>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Chip icon={meta.tier === "deep_dive" ? Telescope : Zap}>{meta.tier === "deep_dive" ? "Deep Dive" : "Standard"} tier</Chip>
                  <Chip icon={FileText}>{meta.wordCount.toLocaleString()} words</Chip>
                  {meta.segments > 1 && <Chip icon={Layers}>{meta.segments} segments synthesised</Chip>}
                  <Chip icon={Cpu}>{meta.model}</Chip>
                  <Chip icon={Clock}>{formatDuration(meta.durationMs)}</Chip>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={exportMarkdown} className="toolbar-btn">
                  <FileText className="size-4" /> Export .md
                </button>
                <button type="button" onClick={exportJson} className="toolbar-btn">
                  <FileJson className="size-4" /> Export JSON
                </button>
              </div>
            </section>

            <div className="sticky top-16 z-30 -mx-4 mt-8 border-b border-white/5 bg-ink-950/80 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6">
              <div role="tablist" aria-label="Study suite views" onKeyDown={onTabKeyDown} className="flex gap-1 overflow-x-auto py-2">
                {TABS.map(({ id, label, short, icon: Icon }) => {
                  const selected = activeTab === id;
                  return (
                    <button
                      key={id}
                      ref={(el) => {
                        tabRefs.current[id] = el;
                      }}
                      type="button"
                      role="tab"
                      id={`tab-${id}`}
                      aria-selected={selected}
                      aria-controls={`panel-${id}`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => selectTab(id)}
                      className={`relative flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-violet-400 sm:px-4 ${
                        selected ? "bg-white/[0.07] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                      }`}
                    >
                      <Icon className={`size-4 ${selected ? "text-violet-300" : ""}`} />
                      <span className="sm:hidden">{short}</span>
                      <span className="hidden sm:inline">{label}</span>
                      {counts[id] !== undefined && (
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] tabular-nums ${selected ? "bg-violet-500/25 text-violet-100" : "bg-white/5 text-zinc-500"}`}>
                          {counts[id]}
                        </span>
                      )}
                      {selected && (
                        <span className="absolute inset-x-3 -bottom-2 h-0.5 rounded-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-300" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6" key={meta.generatedAt} ref={panelsRef}>
              {TABS.map(({ id }) =>
                visited.has(id) ? (
                  <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={activeTab !== id} tabIndex={0} className="focus:outline-none">
                    {id === "notes" && <DeepNotesTab notes={deepNotes} title={meta.title} />}
                    {id === "flashcards" && <FlashcardsTab cards={flashcards} active={activeTab === "flashcards"} />}
                    {id === "quiz" && <QuizTab questions={quiz} active={activeTab === "quiz"} />}
                    {id === "mindmap" && (
                      <MindMapTab code={mindMapCode} title={meta.title} notes={deepNotes} active={activeTab === "mindmap"} />
                    )}
                  </div>
                ) : null,
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-zinc-500">
        Superpower Study Suite · powered by a private, self-hosted AI model · no API keys, no cost to students
      </footer>
    </div>
  );
}

function Chip({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-zinc-300">
      <Icon className="size-3.5 text-violet-300" />
      {children}
    </span>
  );
}
