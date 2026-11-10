"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { getEngine } from "@/lib/ai/engine";
import {
  createFolder as dbCreateFolder,
  deleteFolder as dbDeleteFolder,
  deleteMaterial as dbDeleteMaterial,
  deleteProject as dbDeleteProject,
  FOLDER_COLORS,
  getGenerationForUser,
  NotFoundError,
  saveMarkdownOutput,
  updateFolder,
  updateProject,
  type FolderColor,
} from "@/lib/data/projects";
import { clearChat as dbClearChat, recordQuizAttempt, reviewCard as dbReviewCard } from "@/lib/data/study";
import { RATINGS, type Rating } from "@/lib/srs";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const refreshAll = () => revalidatePath("/", "layout");

function fail(err: unknown): ActionResult {
  if (err instanceof NotFoundError) return { ok: false, error: err.message };
  console.error("[study-suite] action failed", err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

function cleanName(value: unknown, max = 80): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanColor(value: unknown): FolderColor {
  return (FOLDER_COLORS as readonly string[]).includes(value as string) ? (value as FolderColor) : "blue";
}

/* ----------------------------- Folders ----------------------------- */

export async function createFolder(name: string, color: string): Promise<ActionResult & { id?: string }> {
  const user = await requireUser();
  const clean = cleanName(name, 60);
  if (!clean) return { ok: false, error: "Give the folder a name." };
  try {
    const folder = await dbCreateFolder(user.id, clean, cleanColor(color));
    refreshAll();
    return { ok: true, id: folder.id };
  } catch (err) {
    return fail(err);
  }
}

export async function editFolder(folderId: string, name: string, color: string): Promise<ActionResult> {
  const user = await requireUser();
  const clean = cleanName(name, 60);
  if (!clean) return { ok: false, error: "Give the folder a name." };
  try {
    await updateFolder(user.id, folderId, { name: clean, color: cleanColor(color) });
    refreshAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function removeFolder(folderId: string, deleteProjects: boolean): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await dbDeleteFolder(user.id, folderId, deleteProjects);
  } catch (err) {
    return fail(err);
  }
  refreshAll();
  redirect("/dashboard");
}

/* ----------------------------- Projects ----------------------------- */

export async function renameProject(projectId: string, title: string): Promise<ActionResult> {
  const user = await requireUser();
  const clean = cleanName(title, 120);
  if (!clean) return { ok: false, error: "Give the project a title." };
  try {
    await updateProject(user.id, projectId, { title: clean });
    refreshAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function moveProject(projectId: string, folderId: string | null): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await updateProject(user.id, projectId, { folderId: folderId || null });
    refreshAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setProjectTier(projectId: string, tier: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await updateProject(user.id, projectId, { tier: tier === "deep_dive" ? "deep_dive" : "standard" });
    refreshAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function removeProject(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await dbDeleteProject(user.id, projectId);
  } catch (err) {
    return fail(err);
  }
  refreshAll();
  redirect("/dashboard");
}

export async function removeMaterial(projectId: string, materialId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await dbDeleteMaterial(user.id, projectId, materialId);
    refreshAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelGeneration(generationId: string): Promise<ActionResult> {
  const user = await requireUser();
  const generation = await getGenerationForUser(user.id, generationId);
  if (!generation) return { ok: false, error: "That item could not be found." };
  await getEngine().cancel(generationId);
  refreshAll();
  return { ok: true };
}

export async function saveMarkdown(projectId: string, type: "notes" | "cheatsheet", markdown: string): Promise<ActionResult> {
  const user = await requireUser();
  if (type !== "notes" && type !== "cheatsheet") return { ok: false, error: "That can't be edited." };
  if (typeof markdown !== "string" || markdown.length > 400_000) return { ok: false, error: "That text is too long to save." };
  try {
    await saveMarkdownOutput(user.id, projectId, type, markdown);
    refreshAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ----------------------------- Studying ----------------------------- */

export async function reviewFlashcard(cardId: string, rating: string): Promise<ActionResult & { dueAt?: number }> {
  const user = await requireUser();
  if (!(RATINGS as readonly string[]).includes(rating)) return { ok: false, error: "Unknown rating." };
  try {
    const card = await dbReviewCard(user.id, cardId, rating as Rating);
    return { ok: true, dueAt: card.dueAt.getTime() };
  } catch (err) {
    return fail(err);
  }
}

export async function saveQuizAttempt(projectId: string, score: number, total: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!Number.isFinite(score) || !Number.isFinite(total) || total <= 0) return { ok: false, error: "Invalid score." };
  try {
    await recordQuizAttempt(user.id, projectId, score, total);
    revalidatePath(`/projects/${projectId}/quiz`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function clearChat(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await dbClearChat(user.id, projectId);
    revalidatePath(`/projects/${projectId}/chat`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
