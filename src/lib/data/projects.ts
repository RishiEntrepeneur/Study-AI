import "server-only";

import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { read, schema, write, type AppDb } from "../db";
import type { Folder, Generation, Material, Project } from "../db/schema";
import type { ContextTier, OutputContent, OutputType } from "../types";
import { countWords } from "../text/chunking";

/* -------------------------------------------------------------------------- */
/* Ownership helpers                                                          */
/* -------------------------------------------------------------------------- */

function ownedProject(db: AppDb, userId: string, projectId: string): Project | undefined {
  return db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
}

function ownedFolder(db: AppDb, userId: string, folderId: string): Folder | undefined {
  return db
    .select()
    .from(schema.folders)
    .where(and(eq(schema.folders.id, folderId), eq(schema.folders.userId, userId)))
    .get();
}

export class NotFoundError extends Error {
  constructor(what = "That item") {
    super(`${what} could not be found.`);
    this.name = "NotFoundError";
  }
}

/* -------------------------------------------------------------------------- */
/* Folders                                                                    */
/* -------------------------------------------------------------------------- */

export const FOLDER_COLORS = ["blue", "green", "amber", "rose", "violet", "slate"] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number];

export interface FolderSummary extends Folder {
  projectCount: number;
}

export function listFolders(userId: string): Promise<FolderSummary[]> {
  return read((db) =>
    db
      .select({
        id: schema.folders.id,
        userId: schema.folders.userId,
        name: schema.folders.name,
        color: schema.folders.color,
        createdAt: schema.folders.createdAt,
        projectCount: count(schema.projects.id),
      })
      .from(schema.folders)
      .leftJoin(schema.projects, eq(schema.projects.folderId, schema.folders.id))
      .where(eq(schema.folders.userId, userId))
      .groupBy(schema.folders.id)
      .orderBy(asc(sql`lower(${schema.folders.name})`))
      .all(),
  );
}

export function getFolder(userId: string, folderId: string): Promise<Folder | null> {
  return read((db) => ownedFolder(db, userId, folderId) ?? null);
}

export function createFolder(userId: string, name: string, color: FolderColor): Promise<Folder> {
  return write((db) => db.insert(schema.folders).values({ userId, name, color }).returning().get());
}

export function updateFolder(userId: string, folderId: string, values: { name?: string; color?: FolderColor }): Promise<void> {
  return write((db) => {
    if (!ownedFolder(db, userId, folderId)) throw new NotFoundError("That folder");
    db.update(schema.folders).set(values).where(eq(schema.folders.id, folderId)).run();
  });
}

/** Deletes the folder; its projects move to "Unfiled" unless `deleteProjects` is set. */
export function deleteFolder(userId: string, folderId: string, deleteProjects = false): Promise<void> {
  return write((db) => {
    if (!ownedFolder(db, userId, folderId)) throw new NotFoundError("That folder");
    if (deleteProjects) {
      db.delete(schema.projects)
        .where(and(eq(schema.projects.folderId, folderId), eq(schema.projects.userId, userId)))
        .run();
    }
    db.delete(schema.folders).where(eq(schema.folders.id, folderId)).run();
  });
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

export interface ProjectSummary {
  id: string;
  title: string;
  topic: string;
  folderId: string | null;
  updatedAt: Date;
  outputs: Array<{ type: OutputType; status: Generation["status"] }>;
}

export function listProjects(
  userId: string,
  opts: { folderId?: string | null; limit?: number } = {},
): Promise<ProjectSummary[]> {
  return read((db) => {
    const where = [eq(schema.projects.userId, userId)];
    if (opts.folderId === null) where.push(isNull(schema.projects.folderId));
    else if (opts.folderId) where.push(eq(schema.projects.folderId, opts.folderId));
    let query = db
      .select({
        id: schema.projects.id,
        title: schema.projects.title,
        topic: schema.projects.topic,
        folderId: schema.projects.folderId,
        updatedAt: schema.projects.updatedAt,
      })
      .from(schema.projects)
      .where(and(...where))
      .orderBy(desc(schema.projects.updatedAt))
      .$dynamic();
    if (opts.limit) query = query.limit(opts.limit);
    const rows = query.all();
    if (!rows.length) return [];
    const gens = db
      .select({ projectId: schema.generations.projectId, type: schema.generations.type, status: schema.generations.status })
      .from(schema.generations)
      .where(inArray(schema.generations.projectId, rows.map((r) => r.id)))
      .all();
    return rows.map((r) => ({ ...r, outputs: gens.filter((g) => g.projectId === r.id).map(({ type, status }) => ({ type, status })) }));
  });
}

export interface ProjectBundle {
  project: Project;
  folder: Folder | null;
  materials: Material[];
  generations: Generation[];
}

export function getProjectBundle(userId: string, projectId: string): Promise<ProjectBundle | null> {
  return read((db) => {
    const project = ownedProject(db, userId, projectId);
    if (!project) return null;
    const folder = project.folderId ? (ownedFolder(db, userId, project.folderId) ?? null) : null;
    const materials = db
      .select()
      .from(schema.materials)
      .where(eq(schema.materials.projectId, projectId))
      .orderBy(asc(schema.materials.createdAt))
      .all();
    const generations = db.select().from(schema.generations).where(eq(schema.generations.projectId, projectId)).all();
    return { project, folder, materials, generations };
  });
}

export function parseContent<T extends OutputType>(generation: Generation | undefined, type: T): Extract<OutputContent, { type: T }> | null {
  if (!generation?.content) return null;
  try {
    const parsed = JSON.parse(generation.content) as OutputContent;
    return parsed.type === type ? (parsed as Extract<OutputContent, { type: T }>) : null;
  } catch {
    return null;
  }
}

export interface NewMaterial {
  kind: "text" | "file" | "recording";
  name: string;
  content: string;
}

export interface NewProject {
  title: string;
  topic: string;
  tier: ContextTier;
  folderId: string | null;
  materials: NewMaterial[];
  outputs: OutputType[];
}

/** Creates the project, its materials and one queued generation per requested output. */
export function createProject(userId: string, input: NewProject): Promise<{ projectId: string; generationIds: string[] }> {
  return write((db) => {
    if (input.folderId && !ownedFolder(db, userId, input.folderId)) throw new NotFoundError("That folder");
    const project = db
      .insert(schema.projects)
      .values({ userId, title: input.title, topic: input.topic, tier: input.tier, folderId: input.folderId })
      .returning({ id: schema.projects.id })
      .get();
    for (const m of input.materials) {
      db.insert(schema.materials)
        .values({ projectId: project.id, kind: m.kind, name: m.name, content: m.content, wordCount: countWords(m.content) })
        .run();
    }
    const generationIds = input.outputs.map(
      (type) => db.insert(schema.generations).values({ projectId: project.id, type }).returning({ id: schema.generations.id }).get().id,
    );
    return { projectId: project.id, generationIds };
  });
}

export function updateProject(
  userId: string,
  projectId: string,
  values: { title?: string; topic?: string; tier?: ContextTier; folderId?: string | null },
): Promise<void> {
  return write((db) => {
    if (!ownedProject(db, userId, projectId)) throw new NotFoundError("That project");
    if (values.folderId && !ownedFolder(db, userId, values.folderId)) throw new NotFoundError("That folder");
    db.update(schema.projects)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId))
      .run();
  });
}

export function deleteProject(userId: string, projectId: string): Promise<void> {
  return write((db) => {
    if (!ownedProject(db, userId, projectId)) throw new NotFoundError("That project");
    db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
  });
}

export function addMaterials(userId: string, projectId: string, items: NewMaterial[]): Promise<void> {
  return write((db) => {
    if (!ownedProject(db, userId, projectId)) throw new NotFoundError("That project");
    for (const m of items) {
      db.insert(schema.materials)
        .values({ projectId, kind: m.kind, name: m.name, content: m.content, wordCount: countWords(m.content) })
        .run();
    }
    db.update(schema.projects).set({ updatedAt: new Date() }).where(eq(schema.projects.id, projectId)).run();
  });
}

export function deleteMaterial(userId: string, projectId: string, materialId: string): Promise<void> {
  return write((db) => {
    if (!ownedProject(db, userId, projectId)) throw new NotFoundError("That project");
    db.delete(schema.materials)
      .where(and(eq(schema.materials.id, materialId), eq(schema.materials.projectId, projectId)))
      .run();
  });
}

/** Queue (or re-queue) outputs. Existing content is kept until the new version is ready. */
export function queueGenerations(userId: string, projectId: string, types: OutputType[]): Promise<string[]> {
  return write((db) => {
    if (!ownedProject(db, userId, projectId)) throw new NotFoundError("That project");
    const ids: string[] = [];
    for (const type of types) {
      const existing = db
        .select()
        .from(schema.generations)
        .where(and(eq(schema.generations.projectId, projectId), eq(schema.generations.type, type)))
        .get();
      if (existing) {
        if (existing.status === "queued" || existing.status === "running") {
          ids.push(existing.id);
          continue;
        }
        db.update(schema.generations)
          .set({ status: "queued", error: null, queuedAt: new Date(), startedAt: null, finishedAt: null })
          .where(eq(schema.generations.id, existing.id))
          .run();
        ids.push(existing.id);
      } else {
        ids.push(db.insert(schema.generations).values({ projectId, type }).returning({ id: schema.generations.id }).get().id);
      }
    }
    db.update(schema.projects).set({ updatedAt: new Date() }).where(eq(schema.projects.id, projectId)).run();
    return ids;
  });
}

/** Ownership-checked lookup used by the cancel action. */
export function getGenerationForUser(userId: string, generationId: string): Promise<Generation | null> {
  return read((db) => {
    const row = db
      .select({ generation: schema.generations })
      .from(schema.generations)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.generations.projectId))
      .where(and(eq(schema.generations.id, generationId), eq(schema.projects.userId, userId)))
      .get();
    return row?.generation ?? null;
  });
}

/** Save the student's edits to their notes (or cheat sheet). */
export function saveMarkdownOutput(userId: string, projectId: string, type: "notes" | "cheatsheet", markdown: string): Promise<void> {
  return write((db) => {
    if (!ownedProject(db, userId, projectId)) throw new NotFoundError("That project");
    const content = JSON.stringify({ type, markdown } satisfies OutputContent);
    const existing = db
      .select({ id: schema.generations.id })
      .from(schema.generations)
      .where(and(eq(schema.generations.projectId, projectId), eq(schema.generations.type, type)))
      .get();
    if (existing) {
      db.update(schema.generations).set({ content, status: "done", error: null }).where(eq(schema.generations.id, existing.id)).run();
    } else {
      db.insert(schema.generations).values({ projectId, type, content, status: "done", finishedAt: new Date() }).run();
    }
    db.update(schema.projects).set({ updatedAt: new Date() }).where(eq(schema.projects.id, projectId)).run();
  });
}
