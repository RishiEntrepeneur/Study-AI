"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Keyboard, Maximize2, Minimize2, RotateCcw, Shuffle } from "lucide-react";
import type { Flashcard } from "@/lib/types";
import MathMarkdown from "../MathMarkdown";

function shuffled(length: number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export default function FlashcardsTab({ cards, active = true }: { cards: Flashcard[]; active?: boolean }) {
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const total = order.length;
  const card = cards[order[position]];

  const go = useCallback(
    (delta: number) => {
      setFlipped(false);
      setPosition((p) => Math.min(total - 1, Math.max(0, p + delta)));
    },
    [total],
  );

  const reshuffle = () => {
    setOrder(shuffled(cards.length));
    setPosition(0);
    setFlipped(false);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='tablist']")) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " " || e.key === "Enter") {
        if (target?.closest("button, a")) return; // focused controls activate themselves
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "f" || e.key === "F") setFullscreen((v) => !v);
      else if (e.key === "Escape") setFullscreen(false);
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, active]);

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  if (!card) {
    return <p className="py-16 text-center text-zinc-400">No flashcards were generated for this material.</p>;
  }

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col bg-ink-950/95 p-4 backdrop-blur-xl sm:p-8"
          : "flex flex-col"
      }
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? "Flashcards focus mode" : undefined}
    >
      {/* Top bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-sm text-zinc-200">
            {position + 1} <span className="text-zinc-500">/ {total}</span>
          </span>
          <span className="hidden items-center gap-1.5 text-xs text-zinc-500 sm:flex">
            <Keyboard className="size-3.5" /> Space flip · ← → navigate · F focus
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={reshuffle} className="toolbar-btn" aria-label="Shuffle cards">
            <Shuffle className="size-4" /> <span className="hidden sm:inline">Shuffle</span>
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            className="toolbar-btn"
            aria-label={fullscreen ? "Exit focus mode" : "Enter focus mode"}
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            <span className="hidden sm:inline">{fullscreen ? "Exit focus" : "Focus mode"}</span>
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-5 h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-[width] duration-500"
          style={{ width: `${((position + 1) / total) * 100}%` }}
        />
      </div>

      {/* Card */}
      <div className={`flip-scene relative w-full ${fullscreen ? "flex-1" : "h-[24rem] sm:h-[28rem]"}`}>
        <button
          key={order[position]}
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-label={flipped ? "Show question" : "Reveal answer"}
          aria-live="polite"
          className="block size-full cursor-pointer rounded-3xl text-left animate-card-in focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400"
        >
          <div className={`flip-card ${flipped ? "is-flipped" : ""}`}>
            {/* Front */}
            <div className="flip-face flex flex-col border border-white/10 bg-gradient-to-br from-ink-800 via-ink-850 to-ink-900 shadow-[0_30px_80px_-30px_rgba(124,58,237,0.55)]">
              <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-violet-600/20 blur-3xl" />
              <div className="flex items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
                <span className="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-violet-200 uppercase">
                  Question
                </span>
                <span className="text-xs text-zinc-500">Tap to reveal</span>
              </div>
              <div className="relative flex flex-1 items-center justify-center overflow-y-auto px-6 py-6 sm:px-14">
                <MathMarkdown className="prose prose-invert max-w-none text-center text-xl leading-relaxed font-medium text-white sm:text-2xl prose-p:my-2 prose-strong:text-violet-200">
                  {card.question}
                </MathMarkdown>
              </div>
            </div>
            {/* Back */}
            <div className="flip-face flip-face-back flex flex-col border border-cyan-400/20 bg-gradient-to-br from-[#0b1a26] via-ink-850 to-[#101030] shadow-[0_30px_80px_-30px_rgba(34,211,238,0.45)]">
              <div className="pointer-events-none absolute -bottom-24 -left-24 size-64 rounded-full bg-cyan-500/15 blur-3xl" />
              <div className="flex items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
                <span className="rounded-full bg-cyan-400/15 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-cyan-200 uppercase">
                  Answer
                </span>
                <RotateCcw className="size-4 text-zinc-500" aria-hidden />
              </div>
              <div className="relative flex flex-1 items-center justify-center overflow-y-auto px-6 py-6 sm:px-14">
                <MathMarkdown className="prose prose-invert max-w-none text-center text-lg leading-relaxed text-zinc-100 sm:text-xl prose-p:my-2 prose-strong:text-cyan-200 prose-em:text-cyan-100">
                  {card.answer}
                </MathMarkdown>
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-center gap-3">
        <button type="button" onClick={() => go(-1)} disabled={position === 0} className="toolbar-btn px-4 py-2.5">
          <ChevronLeft className="size-4" /> Back
        </button>
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(168,85,247,0.8)] transition hover:brightness-110"
        >
          <RotateCcw className="size-4" /> Flip
        </button>
        <button type="button" onClick={() => go(1)} disabled={position === total - 1} className="toolbar-btn px-4 py-2.5">
          Next <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
