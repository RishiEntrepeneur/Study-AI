/**
 * Keeps the most recent study suite on this device only, so a page refresh
 * never throws away a long generation. Every access is guarded: storage can be
 * unavailable (private mode, blocked site data) and the app must still work.
 */

import type { StudySuiteResponse } from "../types";

const KEY = "superpower-study-suite:last:v1";

export function saveLastSuite(suite: StudySuiteResponse): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(suite));
  } catch {
    /* quota exceeded or storage blocked: non-fatal */
  }
}

export function loadLastSuite(): StudySuiteResponse | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudySuiteResponse;
    if (typeof parsed?.deepNotes !== "string" || !Array.isArray(parsed.flashcards) || !parsed.meta) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLastSuite(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
