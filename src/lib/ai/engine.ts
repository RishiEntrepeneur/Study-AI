import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { read, schema, write } from "../db";
import { replaceProjectCards } from "../data/study";
import { parseContent } from "../data/projects";
import type { GenerationProgress, OutputContent } from "../types";
import { getAIConfig } from "./config";
import { describeAIError } from "./errors";
import { generateOutput } from "./generate";
import { isAbortError } from "./ollama";

/**
 * In-process job queue. A local model can only do one thing at a time well,
 * so outputs are generated one after another. Status lives in the database;
 * live progress (token counts) lives in memory.
 */

const CONCURRENCY = 1;
const TRANSIENT_RETRY_DELAYS_MS = [5_000, 15_000];

interface ActiveJob {
  abort: AbortController;
  progress: GenerationProgress;
}

class GenerationEngine {
  private queue: string[] = [];
  private active = new Map<string, ActiveJob>();
  private running = 0;
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
    while (this.running < CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      this.running++;
      void this.run(id).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  progress(id: string): GenerationProgress | null {
    return this.active.get(id)?.progress ?? null;
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
      return; // run() records the cancellation
    }
    await write((db) =>
      db
        .update(schema.generations)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(and(eq(schema.generations.id, id), inArray(schema.generations.status, ["queued", "running"])))
        .run(),
    );
  }

  private async run(id: string): Promise<void> {
    const job = await read((db) => {
      const generation = db.select().from(schema.generations).where(eq(schema.generations.id, id)).get();
      if (!generation || generation.status !== "queued") return null;
      const project = db.select().from(schema.projects).where(eq(schema.projects.id, generation.projectId)).get();
      if (!project) return null;
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
      return { generation, project, materials, notes };
    });
    if (!job) return;

    const { generation, project, materials } = job;
    const abort = new AbortController();
    const active: ActiveJob = { abort, progress: { tokens: 0, part: 1, parts: 1 } };
    this.active.set(id, active);

    await write((db) =>
      db.update(schema.generations).set({ status: "running", startedAt: new Date(), error: null }).where(eq(schema.generations.id, id)).run(),
    );

    const cfg = getAIConfig();
    const materialText =
      materials.length <= 1
        ? (materials[0]?.content ?? "")
        : materials.map((m) => `## Source: ${m.name}\n\n${m.content}`).join("\n\n");

    try {
      let content: OutputContent | null = null;
      for (let attempt = 0; ; attempt++) {
        try {
          content = await generateOutput({
            cfg,
            type: generation.type,
            tier: project.tier,
            title: project.title,
            topic: project.topic,
            materialText,
            notesMarkdown: parseContent(job.notes, "notes")?.markdown,
            signal: abort.signal,
            onProgress: (p) => {
              active.progress = { ...p, note: undefined };
            },
          });
          break;
        } catch (err) {
          const described = describeAIError(err, cfg.model);
          const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
          if (!described.transient || delay === undefined || abort.signal.aborted) throw err;
          active.progress = { ...active.progress, tokens: 0, note: "Waiting for the AI server…" };
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, delay);
            abort.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
          });
          abort.signal.throwIfAborted();
        }
      }

      if (content?.type === "flashcards") await replaceProjectCards(project.id, content.cards);
      await write((db) => {
        db.update(schema.generations)
          .set({ status: "done", content: JSON.stringify(content), error: null, finishedAt: new Date() })
          .where(eq(schema.generations.id, id))
          .run();
        db.update(schema.projects).set({ updatedAt: new Date() }).where(eq(schema.projects.id, project.id)).run();
      });
    } catch (err) {
      const cancelled = abort.signal.aborted || isAbortError(err);
      const message = cancelled ? null : describeAIError(err, cfg.model).message;
      if (!cancelled) console.warn(`[study-suite] ${generation.type} for project ${project.id} failed: ${message}`);
      await write((db) =>
        db
          .update(schema.generations)
          .set({ status: cancelled ? "cancelled" : "error", error: message, finishedAt: new Date() })
          .where(eq(schema.generations.id, id))
          .run(),
      );
    } finally {
      this.active.delete(id);
    }
  }
}

const globalForEngine = globalThis as unknown as { __studyEngine?: GenerationEngine };

export function getEngine(): GenerationEngine {
  globalForEngine.__studyEngine ??= new GenerationEngine();
  return globalForEngine.__studyEngine;
}
