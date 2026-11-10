import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Use a throwaway database for this test file.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "study-db-"));

const db = await import("@/lib/db");
const projects = await import("@/lib/data/projects");
const study = await import("@/lib/data/study");

let userId = "";
let otherUserId = "";

beforeAll(async () => {
  const [u, o] = await db.write((d) => [
    d.insert(db.schema.users).values({ email: "a@example.com", name: "A", passwordHash: "x" }).returning().get(),
    d.insert(db.schema.users).values({ email: "b@example.com", name: "B", passwordHash: "x" }).returning().get(),
  ]);
  userId = u.id;
  otherUserId = o.id;
});

describe("data layer", () => {
  it("creates projects with materials and queued outputs, scoped to the owner", async () => {
    const folder = await projects.createFolder(userId, "Bio", "green");
    const { projectId, generationIds } = await projects.createProject(userId, {
      title: "Cells",
      topic: "Cell biology",
      tier: "standard",
      folderId: folder.id,
      materials: [{ kind: "text", name: "Pasted text", content: "Cells are the basic unit of life." }],
      outputs: ["notes", "flashcards"],
    });
    expect(generationIds).toHaveLength(2);
    const bundle = await projects.getProjectBundle(userId, projectId);
    expect(bundle?.materials[0].wordCount).toBe(7);
    expect(bundle?.generations.map((g) => g.status)).toEqual(["queued", "queued"]);
    // Another user can't see or change it.
    expect(await projects.getProjectBundle(otherUserId, projectId)).toBeNull();
    await expect(projects.updateProject(otherUserId, projectId, { title: "x" })).rejects.toThrow(/could not be found/);
    const folders = await projects.listFolders(userId);
    expect(folders[0].projectCount).toBe(1);
  });

  it("re-queues instead of duplicating outputs", async () => {
    const { projectId } = await projects.createProject(userId, { title: "P", topic: "t", tier: "standard", folderId: null, materials: [], outputs: ["quiz"] });
    const first = await projects.queueGenerations(userId, projectId, ["quiz", "terms"]);
    const bundle = await projects.getProjectBundle(userId, projectId);
    expect(bundle?.generations).toHaveLength(2);
    expect(first).toHaveLength(2);
  });

  it("stores flashcards, schedules reviews and cascades deletes after a save to disk", async () => {
    const { projectId } = await projects.createProject(userId, { title: "SRS", topic: "t", tier: "standard", folderId: null, materials: [], outputs: ["flashcards"] });
    await study.replaceProjectCards(projectId, [
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
    ]);
    const due = await study.dueCards(userId, { projectId });
    expect(due).toHaveLength(2);
    const reviewed = await study.reviewCard(userId, due[0].id, "good");
    expect(reviewed.intervalDays).toBe(1);
    expect(await study.countDueCards(userId)).toBeGreaterThanOrEqual(1);
    await expect(study.reviewCard(otherUserId, due[1].id, "good")).rejects.toThrow();

    await db.flushDb(); // export() reopens the database; foreign keys must still cascade
    expect(existsSync(path.join(process.env.DATA_DIR!, "study-suite.db"))).toBe(true);
    await projects.deleteProject(userId, projectId);
    const left = await db.read((d) => d.select().from(db.schema.flashcards).all().filter((c) => c.projectId === projectId));
    expect(left).toHaveLength(0);
  });

  it("deleting a folder keeps its projects by default", async () => {
    const folder = await projects.createFolder(userId, "Temp", "rose");
    const { projectId } = await projects.createProject(userId, { title: "Keep me", topic: "t", tier: "standard", folderId: folder.id, materials: [], outputs: ["notes"] });
    await projects.deleteFolder(userId, folder.id);
    const bundle = await projects.getProjectBundle(userId, projectId);
    expect(bundle?.project.folderId).toBeNull();
  });
});
