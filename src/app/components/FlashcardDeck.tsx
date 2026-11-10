"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, RotateCcw, Shuffle } from "lucide-react";
import type { CardStage } from "@/lib/srs";
import MathMarkdown from "./MathMarkdown";

export interface DeckCard {
  id: string;
  question: string;
  answer: string;
  stage: CardStage;
}

const STAGE_LABEL: Record<CardStage, { text: string; className: string }> = {
  new: { text: "New", className: "bg-accent-soft text-accent" },
  learning: { text: "Learning", className: "bg-warn-soft text-warn" },
  review: { text: "Reviewing", className: "bg-subtle text-muted" },
  mastered: { text: "Mastered", className: "bg-good-soft text-good" },
};

function shuffled(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** A single index card that flips on click. Shared by browsing and review. */
export function IndexCard({
  question,
  answer,
  flipped,
  onFlip,
  label,
  className = "h-[22rem] sm:h-[24rem]",
}: {
  question: string;
  answer: string;
  flipped: boolean;
  onFlip: () => void;
  label?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flip-scene w-full ${className}`}>
      <button
        type="button"
        onClick={onFlip}
        aria-label={flipped ? "Flip card to the question" : "Flip card to the answer"}
        className="block size-full cursor-pointer rounded-lg text-left"
      >
        <div className={`flip-card ${flipped ? "is-flipped" : ""}`}>
          <div className="flip-face index-card flex flex-col rounded-lg border border-line shadow-sm">
            <div className="flex h-[3.4rem] items-center justify-between px-5 sm:px-8">
              <span className="text-xs font-semibold tracking-[0.08em] text-faint uppercase">Question</span>
              {label}
            </div>
            <div className="flex flex-1 items-center justify-center overflow-y-auto px-5 py-4 sm:px-12">
              <MathMarkdown className="prose max-w-none text-center font-serif text-xl leading-[2rem] dark:prose-invert sm:text-2xl prose-p:my-0 prose-strong:text-ink">
                {question}
              </MathMarkdown>
            </div>
            <p className="pb-3 text-center text-xs text-faint">Click or press Space to flip</p>
          </div>
          <div className="flip-face flip-face-back index-card flex flex-col rounded-lg border border-accent/30 shadow-sm">
            <div className="flex h-[3.4rem] items-center justify-between px-5 sm:px-8">
              <span className="text-xs font-semibold tracking-[0.08em] text-accent uppercase">Answer</span>
              <RotateCcw className="size-3.5 text-faint" aria-hidden />
            </div>
            <div className="flex flex-1 items-center justify-center overflow-y-auto px-5 py-4 sm:px-12">
              <MathMarkdown className="prose max-w-none text-center font-serif text-lg leading-[2rem] dark:prose-invert sm:text-xl prose-p:my-0 prose-strong:text-ink">
                {answer}
              </MathMarkdown>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

export default function FlashcardDeck({ cards }: { cards: DeckCard[] }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [focus, setFocus] = useState(false);
  const total = order.length;
  const card = cards[order[position]];

  const go = useCallback(
    (delta: number) => {
      setFlipped(false);
      setPosition((p) => Math.min(total - 1, Math.max(0, p + delta)));
    },
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true'], dialog")) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " " && !t?.closest("button, a")) {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "Escape") setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  useEffect(() => {
    if (!focus) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [focus]);

  if (!card) return null;
  const stage = STAGE_LABEL[card.stage];

  return (
    <div
      className={focus ? "fixed inset-0 z-50 flex flex-col bg-bg p-4 sm:p-8" : ""}
      role={focus ? "dialog" : undefined}
      aria-modal={focus || undefined}
      aria-label={focus ? "Flashcards" : undefined}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm text-muted tabular-nums">
          {position + 1} / {total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setOrder(shuffled(cards.length));
              setPosition(0);
              setFlipped(false);
            }}
            className="btn btn-ghost btn-sm"
          >
            <Shuffle className="size-3.5" /> Shuffle
          </button>
          <button type="button" onClick={() => setFocus((f) => !f)} className="btn btn-ghost btn-sm">
            {focus ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />} {focus ? "Exit focus" : "Focus"}
          </button>
        </div>
      </div>
      <div className="mb-4 h-1 overflow-hidden rounded-full bg-subtle">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${((position + 1) / total) * 100}%` }} />
      </div>

      <div key={card.id} className={`animate-fade-in ${focus ? "flex-1" : ""}`}>
        <IndexCard
          question={card.question}
          answer={card.answer}
          flipped={flipped}
          onFlip={() => setFlipped((f) => !f)}
          className={focus ? "h-full" : undefined}
          label={<span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${stage.className}`}>{stage.text}</span>}
        />
      </div>

      <div className="mt-5 flex items-center justify-center gap-2">
        <button type="button" onClick={() => go(-1)} disabled={position === 0} className="btn btn-secondary">
          <ChevronLeft className="size-4" /> Back
        </button>
        <button type="button" onClick={() => setFlipped((f) => !f)} className="btn btn-primary">
          <RotateCcw className="size-4" /> Flip
        </button>
        <button type="button" onClick={() => go(1)} disabled={position === total - 1} className="btn btn-secondary">
          Next <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
