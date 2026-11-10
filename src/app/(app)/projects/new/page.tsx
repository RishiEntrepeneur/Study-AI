import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { listFolders } from "@/lib/data/projects";
import CreateProjectForm from "../../../components/CreateProjectForm";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage(props: PageProps<"/projects/new">) {
  const user = await requireUser();
  const { folder } = await props.searchParams;
  const folders = await listFolders(user.id);
  const defaultFolderId = typeof folder === "string" && folders.some((f) => f.id === folder) ? folder : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
      <p className="mt-1 mb-8 text-muted">Tell me what you&apos;re studying, then pick what you&apos;d like me to make.</p>
      <CreateProjectForm folders={folders.map((f) => ({ id: f.id, name: f.name }))} defaultFolderId={defaultFolderId} />
    </div>
  );
}
