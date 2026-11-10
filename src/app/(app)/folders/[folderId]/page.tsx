import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { getFolder, listProjects } from "@/lib/data/projects";
import { folderHex } from "@/lib/folderColors";
import FolderActions from "../../../components/FolderActions";
import ProjectList from "../../../components/ProjectList";

export async function generateMetadata(props: PageProps<"/folders/[folderId]">): Promise<Metadata> {
  const user = await requireUser();
  const folder = await getFolder(user.id, (await props.params).folderId);
  return { title: folder?.name ?? "Folder" };
}

export default async function FolderPage(props: PageProps<"/folders/[folderId]">) {
  const user = await requireUser();
  const { folderId } = await props.params;
  const folder = await getFolder(user.id, folderId);
  if (!folder) notFound();
  const projects = await listProjects(user.id, { folderId });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="h-1.5 w-16 rounded-full" style={{ backgroundColor: folderHex(folder.color) }} />
      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{folder.name}</h1>
          <p className="mt-1 text-muted">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </p>
        </div>
        <FolderActions folder={{ id: folder.id, name: folder.name, color: folder.color, projectCount: projects.length }} />
      </header>

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Projects</h2>
        <Link href={`/projects/new?folder=${folder.id}`} className="btn btn-primary btn-sm">
          <Plus className="size-4" /> New project here
        </Link>
      </div>
      {projects.length > 0 ? (
        <ProjectList projects={projects} />
      ) : (
        <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
          <p className="font-medium">This folder is empty</p>
          <p className="mt-1 text-sm text-muted">Create a project here, or move existing projects in from their settings.</p>
        </div>
      )}
    </div>
  );
}
