import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { read, schema, write } from "../db";
import { replaceProjectCards } from "../data/study";
import { parseContent } from "../data/projects";
import type { GenerationProgress, GenerationProgressView, OutputContent, OutputType } from "../types";
import { getAIConfig } from "./config";
import { describeAIError } from "./errors";
import { generateBatch, type BatchItem } from "./generate";
import { isAbortError } from "./ollama";

/**
 * In-process job queue. A local model can only do one thing at a time well,
 * so projects are worked on one after another. All the outputs queued for a
 * project are made together (see generateBatch), which lets the model read
 * the material once instead of once per output. Status lives in the
 * database; live progress lives in memory.
 */

interface ActiveJob {
  type: OutputType;
  abort: AbortController;
  progress: GenerationProgress;
}

const ITEM_PATTERNS: Partial<Record<OutputType, RegExp>> = {
  flashcards: /"answer"\s*:/g,
  quiz: /"explanation"\s*:/g,
  terms: /"definition"\s*:/g,
};

/** Turn raw progress into what the browser needs (no raw JSON, just counts or a readable preview). */
export function progressView(type: OutputType, p: GenerationProgress): GenerationProgressView {
  const view: GenerationProgressView = { tokens: p.tokens, part: p.part, parts: p.parts, note: p.note };
  const text = p.text ?? "";
  if (!text) return view;
  if (type === "notes" || type === "cheatsheet") {
    view.words = text.match(/\S+/g)?.length ?? 0;
    const tail = text.length > 1_500 ? `…${text.slice(-1_500).replace(/^\S*\s/, "")}` : text;
    // Easier to read than raw Markdown: drop heading marks and bold/italic stars, show bullets as dots.
    view.preview = tail
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1$2")
      .replace(/^(\s*)[-*]\s+/gm, "$1• ");
  } else if (ITEM_PATTERNS[type]) {
    view.items = text.match(ITEM_PATTERNS[type]!)?.length ?? 0;
  }
  return view;
}

class GenerationEngine {
  private queue: string[] = [];
  private active = new Map<string, ActiveJob>();
  private running = false;
  /** The output the model is writing right now. */
  private current: string | null = null;
  private resumed: Promise<void> | null = null;

  /** Re-queue work interrupted by a restart, once per process. */
  ensureStarted(): Promise<void> {
    this.resumed ??= (async () => {
      const ids = await write((db) => {
        db.update(schema.generations).set({ status: "queued", startedAt: null }).where(eq(schema.generations.status, "running")).run();
        return db
          .select({ id: schema.generations.id })
          .from(schema.generations)
          .where(eq(schema.generations.status, "queued"))
          .orderBy(asc(schema.generations.queuedAt))
          .all()
          .map((r) => r.id);
      });
      this.add(ids);
    })().catch((err) => {
      this.resumed = null;
      throw err;
    });
    return this.resumed;
  }

  async enqueue(ids: string[]): Promise<void> {
    await this.ensureStarted();
    this.add(ids);
  }

  private add(ids: string[]) {
    for (const id of ids) {
      if (!this.queue.includes(id) && !this.active.has(id)) this.queue.push(id);
    }
    this.pump();
  }

  private pump() {
    if (this.running || !this.queue.length) return;
    this.running = true;
    void this.runNext()
      .catch((err) => console.error("[study-suite] generation queue error", err))
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }

  progress(id: string): GenerationProgressView | null {
    const job = this.active.get(id);
    return job ? progressView(job.type, job.progress) : null;
  }

  isQueuedOrActive(id: string): boolean {
    return this.active.has(id) || this.queue.includes(id);
  }

  /** Cancel a queued or running generation. Previous content (if any) is kept. */
  async cancel(id: string): Promise<void> {
    this.queue = this.queue.filter((q) => q !== id);
    const job = this.active.get(id);
    if (job) {
      job.abort.abort();
      if (this.current === id) return; // the model call stops and the batch records it
      // Still waiting for its turn: settle it now (the batch skips it later).
      this.active.delete(id);
    }
    await write((db) =>
      db
        .update(schema.generations)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(and(eq(schema.generations.id, id), inArray(schema.generations.status, ["queued", "running"])))
        .run(),
    );
  }

  /** Take the next queued output, plus every other output queued for the same project, and make them together. */
  private async runNext(): Promise<void> {
    const firstId = this.queue.shift();
    if (!firstId) return;
    const job = await read((db) => {
      const first = db.select().from(schema.generations).where(eq(schema.generations.id, firstId)).get();
      if (!first || first.status !== "queued") return null;
      const project = db.select().from(schema.projects).where(eq(schema.projects.id, first.projectId)).get();
      if (!project) return null;
      const siblings = this.queue.length
        ? db
            .select()
            .from(schema.generations)
            .where(and(eq(schema.generations.projectId, project.id), eq(schema.generations.status, "queued"), inArray(schema.generations.id, this.queue)))
            .all()
        : [];
      const materials = db
        .select({ name: schema.materials.name, content: schema.materials.content })
        .from(schema.materials)
        .where(eq(schema.materials.projectId, project.id))
        .orderBy(asc(schema.materials.createdAt))
        .all();
      const notes = db
        .select()
        .from(schema.generations)
        .where(and(eq(schema.generations.projectId, project.id), eq(schema.generations.type, "notes")))
        .get();
      return { generations: [first, ...siblings], project, materials, notes };
    });
    if (!job) return;

    const { generations, project, materials } = job;
    const ids = generations.map((g) => g.id);
    this.queue = this.queue.filter((q) => !ids.includes(q));
    for (const g of generations) {
      this.active.set(g.id, { type: g.type, abort: new AbortController(), progress: { tokens: 0, part: 1, parts: 1, note: "Waiting for its turn…" } });
    }
    await write((db) =>
      db.update(schema.generations).set({ status: "running", startedAt: new Date(), error: null }).where(inArray(schema.generations.id, ids)).run(),
    );

    const cfg = getAIConfig();
    const materialText =
      materials.length <= 1
        ? (materials[0]?.content ?? "")
        : materials.map((m) => `## Source: ${m.name}\n\n${m.content}`).join("\n\n");

    const finish = async (id: string, values: Partial<typeof schema.generations.$inferInsert>) => {
      this.active.delete(id);
      if (this.current === id) this.current = null;
      await write((db) => {
        db.update(schema.generations).set({ ...values, finishedAt: new Date() }).where(eq(schema.generations.id, id)).run();
        if (values.status === "done") db.update(schema.projects).set({ updatedAt: new Date() }).where(eq(schema.projects.id, project.id)).run();
      });
    };

    const items: BatchItem[] = generations.map((g) => {
      const active = this.active.get(g.id)!;
      return {
        type: g.type,
        signal: active.abort.signal,
        onProgress: (p) => {
          active.progress = p;
          if (p.text !== undefined) this.current = g.id;
        },
        onDone: async (content: OutputContent) => {
          if (content.type === "flashcards") await replaceProjectCards(project.id, content.cards);
          await finish(g.id, { status: "done", content: JSON.stringify(content), error: null });
        },
        onFailed: async (err) => {
          if (!this.active.has(g.id) && active.abort.signal.aborted) return; // already settled by cancel()
          const cancelled = active.abort.signal.aborted || isAbortError(err);
          const message = cancelled ? null : describeAIError(err, cfg.model).message;
          if (!cancelled) console.warn(`[study-suite] ${g.type} for project ${project.id} failed: ${message}`);
          await finish(g.id, { status: cancelled ? "cancelled" : "error", error: message });
        },
      };
    });

    try {
      await generateBatch({
        cfg,
        tier: project.tier,
        title: project.title,
        topic: project.topic,
        materialText,
        existingNotes: parseContent(job.notes, "notes")?.markdown,
        items,
      });
    } catch (err) {
      console.error("[study-suite] batch failed", err);
    } finally {
      // Anything the batch didn't settle (an unexpected crash) is marked as failed, never left "running".
      for (const [i, g] of generations.entries()) {
        if (this.active.has(g.id)) await items[i].onFailed(new Error("Something went wrong while making this. Please try again."));
      }
      this.current = null;
    }
  }
}

const globalForEngine = globalThis as unknown as { __studyEngine?: GenerationEngine };

export function getEngine(): GenerationEngine {
  globalForEngine.__studyEngine ??= new GenerationEngine();
  return globalForEngine.__studyEngine;
}
