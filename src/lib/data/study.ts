import "server-only";

import { and, asc, avg, count, desc, eq, lte, sql } from "drizzle-orm";
import { read, schema, write } from "../db";
import type { ChatMessage, FlashcardRow, QuizAttempt } from "../db/schema";
import { schedule, type Rating } from "../srs";
import type { Flashcard } from "../types";
import { NotFoundError } from "./projects";

function assertProject(userId: string, projectId: string) {
  return read((db) => {
    const p = db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
      .get();
    if (!p) throw new NotFoundError("That project");
  });
}

/* -------------------------------------------------------------------------- */
/* Flashcards & spaced repetition                                             */
/* -------------------------------------------------------------------------- */

export async function listProjectCards(userId: string, projectId: string): Promise<FlashcardRow[]> {
  await assertProject(userId, projectId);
  return read((db) =>
    db.select().from(schema.flashcards).where(eq(schema.flashcards.projectId, projectId)).orderBy(asc(schema.flashcards.position)).all(),
  );
}

export interface DueCard extends FlashcardRow {
  projectTitle: string;
}

export function dueCards(userId: string, opts: { projectId?: string; limit?: number } = {}): Promise<DueCard[]> {
  return read((db) => {
    const where = [eq(schema.projects.userId, userId), lte(schema.flashcards.dueAt, new Date())];
    if (opts.projectId) where.push(eq(schema.flashcards.projectId, opts.projectId));
    return db
      .select({ card: schema.flashcards, projectTitle: schema.projects.title })
      .from(schema.flashcards)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.flashcards.projectId))
      .where(and(...where))
      .orderBy(asc(schema.flashcards.dueAt), asc(schema.flashcards.position))
      .limit(opts.limit ?? 200)
      .all()
      .map((r) => ({ ...r.card, projectTitle: r.projectTitle }));
  });
}

export function countDueCards(userId: string, projectId?: string): Promise<number> {
  return read((db) => {
    const where = [eq(schema.projects.userId, userId), lte(schema.flashcards.dueAt, new Date())];
    if (projectId) where.push(eq(schema.flashcards.projectId, projectId));
    return (
      db
        .select({ n: count() })
        .from(schema.flashcards)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.flashcards.projectId))
        .where(and(...where))
        .get()?.n ?? 0
    );
  });
}

export function nextDueAt(userId: string): Promise<Date | null> {
  return read(
    (db) =>
      db
        .select({ dueAt: schema.flashcards.dueAt })
        .from(schema.flashcards)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.flashcards.projectId))
        .where(eq(schema.projects.userId, userId))
        .orderBy(asc(schema.flashcards.dueAt))
        .limit(1)
        .get()?.dueAt ?? null,
  );
}

export function reviewCard(userId: string, cardId: string, rating: Rating): Promise<FlashcardRow> {
  return write((db) => {
    const row = db
      .select({ card: schema.flashcards })
      .from(schema.flashcards)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.flashcards.projectId))
      .where(and(eq(schema.flashcards.id, cardId), eq(schema.projects.userId, userId)))
      .get();
    if (!row) throw new NotFoundError("That card");
    const next = schedule(row.card, rating);
    return db
      .update(schema.flashcards)
      .set({
        intervalDays: next.intervalDays,
        ease: next.ease,
        reps: next.reps,
        lapses: next.lapses,
        dueAt: new Date(next.dueAt),
        lastReviewedAt: new Date(),
      })
      .where(eq(schema.flashcards.id, cardId))
      .returning()
      .get();
  });
}

/** Called by the generation engine: replace a project's cards with a fresh set. */
export function replaceProjectCards(projectId: string, cards: Flashcard[]): Promise<void> {
  return write((db) => {
    db.delete(schema.flashcards).where(eq(schema.flashcards.projectId, projectId)).run();
    const now = new Date();
    cards.forEach((c, position) => {
      db.insert(schema.flashcards).values({ projectId, question: c.question, answer: c.answer, position, dueAt: now }).run();
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Quiz attempts                                                              */
/* -------------------------------------------------------------------------- */

export async function recordQuizAttempt(userId: string, projectId: string, score: number, total: number): Promise<void> {
  await assertProject(userId, projectId);
  const safeTotal = Math.max(1, Math.min(500, Math.floor(total)));
  const safeScore = Math.max(0, Math.min(safeTotal, Math.floor(score)));
  await write((db) => db.insert(schema.quizAttempts).values({ projectId, score: safeScore, total: safeTotal }).run());
}

export async function listQuizAttempts(userId: string, projectId: string): Promise<QuizAttempt[]> {
  await assertProject(userId, projectId);
  return read((db) =>
    db.select().from(schema.quizAttempts).where(eq(schema.quizAttempts.projectId, projectId)).orderBy(desc(schema.quizAttempts.createdAt)).limit(20).all(),
  );
}

export interface StudyStats {
  projects: number;
  cards: number;
  dueCards: number;
  mastered: number;
  quizAverage: number | null;
  quizzesTaken: number;
}

export function studyStats(userId: string): Promise<StudyStats> {
  return read((db) => {
    const projects = db.select({ n: count() }).from(schema.projects).where(eq(schema.projects.userId, userId)).get()?.n ?? 0;
    const cardRow = db
      .select({
        total: count(),
        due: sql<number>`sum(case when ${schema.flashcards.dueAt} <= ${Date.now()} then 1 else 0 end)`,
        mastered: sql<number>`sum(case when ${schema.flashcards.intervalDays} >= 21 then 1 else 0 end)`,
      })
      .from(schema.flashcards)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.flashcards.projectId))
      .where(eq(schema.projects.userId, userId))
      .get();
    const quizRow = db
      .select({ n: count(), avg: avg(sql`1.0 * ${schema.quizAttempts.score} / ${schema.quizAttempts.total}`) })
      .from(schema.quizAttempts)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.quizAttempts.projectId))
      .where(eq(schema.projects.userId, userId))
      .get();
    return {
      projects,
      cards: cardRow?.total ?? 0,
      dueCards: Number(cardRow?.due ?? 0),
      mastered: Number(cardRow?.mastered ?? 0),
      quizzesTaken: quizRow?.n ?? 0,
      quizAverage: quizRow?.avg != null ? Math.round(Number(quizRow.avg) * 100) : null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Chat                                                                       */
/* -------------------------------------------------------------------------- */

export async function listChat(userId: string, projectId: string): Promise<ChatMessage[]> {
  await assertProject(userId, projectId);
  return read((db) =>
    db.select().from(schema.chatMessages).where(eq(schema.chatMessages.projectId, projectId)).orderBy(asc(schema.chatMessages.createdAt)).all(),
  );
}

export function addChatMessage(projectId: string, role: "user" | "assistant", content: string): Promise<ChatMessage> {
  return write((db) => db.insert(schema.chatMessages).values({ projectId, role, content }).returning().get());
}

export async function clearChat(userId: string, projectId: string): Promise<void> {
  await assertProject(userId, projectId);
  await write((db) => db.delete(schema.chatMessages).where(eq(schema.chatMessages.projectId, projectId)).run());
}
