"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { reviewFlashcard } from "../actions/library";
import { formatInterval, RATINGS, schedule, type Rating, type SrsState } from "@/lib/srs";
import { IndexCard } from "./FlashcardDeck";

export interface ReviewCard extends SrsState {
  id: string;
  question: string;
  answer: string;
  projectId: string;
  projectTitle: string;
}

const RATING_UI: Record<Rating, { label: string; className: string; key: string }> = {
  again: { label: "Again", className: "border-bad/40 text-bad hover:bg-bad-soft", key: "1" },
  hard: { label: "Hard", className: "border-warn/40 text-warn hover:bg-warn-soft", key: "2" },
  good: { label: "Good", className: "border-good/40 text-good hover:bg-good-soft", key: "3" },
  easy: { label: "Easy", className: "border-accent/40 text-accent hover:bg-accent-soft", key: "4" },
};

/** Spaced-repetition session: flip, then rate how well you remembered. */
export default function ReviewSession({ cards: initial, nextDue }: { cards: ReviewCard[]; nextDue: string | null }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initial);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const card = queue[0];

  const previews = useMemo(() => {
    if (!card) return null;
    // The interval doesn't depend on the current time, so schedule from t = 0.
    return Object.fromEntries(RATINGS.map((r) => [r, formatInterval(schedule(card, r, 0).dueAt)])) as Record<Rating, string>;
  }, [card]);

  const rate = useCallback(
    (rating: Rating) => {
      if (!card || pending) return;
      start(async () => {
        const res = await reviewFlashcard(card.id, rating);
        if (!res.ok) {
          setError(res.error ?? "Couldn't save that review.");
          return;
        }
        setError(null);
        setFlipped(false);
        setDone((d) => d + 1);
        const next = schedule(card, rating);
        // "Again" cards come back at the end of this session.
        setQueue((q) => (rating === "again" ? [...q.slice(1), { ...card, ...next }] : q.slice(1)));
      });
    },
    [card, pending],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select")) return;
      if (e.key === " " && !t?.closest("button, a")) {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped) {
        const rating = RATINGS.find((r) => RATING_UI[r].key === e.key);
        if (rating) rate(rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, rate]);

  if (!card) {
    return (
      <div className="card px-6 py-14 text-center">
        <CircleCheck className="mx-auto size-10 text-good" />
        <h2 className="mt-4 text-xl font-semibold">{done > 0 ? "Session complete" : "Nothing to review right now"}</h2>
        <p className="mx-auto mt-2 max-w-sm text-muted">
          {done > 0 ? `You reviewed ${done} card${done === 1 ? "" : "s"}. ` : ""}
          {nextDue ? `Your next card is due ${nextDue}.` : "Create flashcards in a project and they'll show up here."}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" onClick={() => router.refresh()} className="btn btn-secondary">
            Check again
          </button>
          <Link href="/dashboard" className="btn btn-primary">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 text-sm">
        <Link href={`/projects/${card.projectId}/flashcards`} className="truncate text-muted hover:text-ink">
          {card.projectTitle}
        </Link>
        <span className="shrink-0 font-mono text-muted tabular-nums">
          {done} done · {queue.length} left
        </span>
      </div>
      <div key={`${card.id}-${done}`} className="animate-fade-in">
        <IndexCard question={card.question} answer={card.answer} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />
      </div>

      <div className="mt-5 min-h-[4.5rem]">
        {flipped && previews ? (
          <div className="animate-fade-in">
            <p className="mb-2 text-center text-sm text-muted">How well did you remember it?</p>
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={pending}
                  onClick={() => rate(r)}
                  className={`flex flex-col items-center rounded-md border bg-surface px-2 py-2 transition-colors disabled:opacity-50 ${RATING_UI[r].className}`}
                >
                  <span className="text-sm font-semibold">{RATING_UI[r].label}</span>
                  <span className="text-[11px] opacity-80">{previews[r]}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-xs text-faint">Keys 1–4</p>
          </div>
        ) : (
          <div className="flex justify-center">
            <button type="button" onClick={() => setFlipped(true)} className="btn btn-primary px-6">
              Show answer
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-center text-sm text-bad">{error}</p>}
      </div>
    </div>
  );
}
