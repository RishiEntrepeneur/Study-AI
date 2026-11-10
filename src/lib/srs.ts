/**
 * Spaced-repetition scheduling (a compact SM-2 variant). Pure functions,
 * shared by the server (to save reviews) and the browser (to label buttons).
 */

export type Rating = "again" | "hard" | "good" | "easy";
export const RATINGS: readonly Rating[] = ["again", "hard", "good", "easy"] as const;

export interface SrsState {
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
}

export interface Scheduled extends SrsState {
  dueAt: number;
}

const DAY = 24 * 60 * 60 * 1000;
const AGAIN_DELAY = 10 * 60 * 1000;
const MAX_INTERVAL = 365;
const MIN_EASE = 1.3;

export function schedule(state: SrsState, rating: Rating, now = Date.now()): Scheduled {
  let { intervalDays, ease, reps, lapses } = state;
  switch (rating) {
    case "again":
      reps = 0;
      lapses += 1;
      ease = Math.max(MIN_EASE, ease - 0.2);
      return { intervalDays: 0, ease, reps, lapses, dueAt: now + AGAIN_DELAY };
    case "hard":
      intervalDays = reps === 0 ? 1 : Math.max(1, intervalDays * 1.2);
      ease = Math.max(MIN_EASE, ease - 0.15);
      break;
    case "good":
      intervalDays = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(intervalDays + 1, intervalDays * ease);
      break;
    case "easy":
      intervalDays = reps === 0 ? 4 : Math.max(intervalDays + 2, intervalDays * ease * 1.3);
      ease += 0.15;
      break;
  }
  reps += 1;
  intervalDays = Math.min(MAX_INTERVAL, Math.round(intervalDays * 10) / 10);
  return { intervalDays, ease, reps, lapses, dueAt: now + intervalDays * DAY };
}

/** Human label for how long until the card comes back, e.g. "10 min", "3 days", "2 mo". */
export function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const days = ms / DAY;
  if (days < 1) return `${Math.round(minutes / 60)} h`;
  if (days < 30) return `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${Math.round(days / 365)} yr`;
}

export type CardStage = "new" | "learning" | "review" | "mastered";

export function cardStage(card: { reps: number; intervalDays: number; lastReviewedAt: Date | number | null }): CardStage {
  if (!card.lastReviewedAt) return "new";
  if (card.intervalDays >= 21) return "mastered";
  if (card.intervalDays < 3) return "learning";
  return "review";
}

/** "now", "in 3 h", "in 2 days" — or null when nothing is scheduled. */
export function describeDue(dueAt: Date | null, now = Date.now()): string | null {
  if (!dueAt) return null;
  const ms = dueAt.getTime() - now;
  return ms <= 0 ? "now" : `in ${formatInterval(ms)}`;
}
