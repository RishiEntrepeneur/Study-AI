import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { listFolders } from "@/lib/data/projects";
import { loadProject } from "@/lib/data/loaders";
import { folderHex } from "@/lib/folderColors";
import { GenerationProvider } from "../../../components/GenerationProvider";
import ProjectActions from "../../../components/ProjectActions";
import ProjectTabs from "../../../components/ProjectTabs";

export async function generateMetadata(props: LayoutProps<"/projects/[projectId]">) {
  const { project } = await loadProject((await props.params).projectId);
  return { title: project.title };
}

export default async function ProjectLayout(props: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await props.params;
  const { user, project, folder, statuses } = await loadProject(projectId);
  const folders = await listFolders(user.id);

  return (
    <GenerationProvider projectId={project.id} initial={statuses}>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-8 sm:pt-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted">
          <Link href={folder ? `/folders/${folder.id}` : "/dashboard"} className="flex items-center gap-1.5 hover:text-ink">
            {folder && <span className="size-2 rounded-sm" style={{ backgroundColor: folderHex(folder.color) }} />}
            {folder ? folder.name : "Home"}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="truncate text-faint">Project</span>
        </nav>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{project.title}</h1>
            {project.topic && project.topic !== project.title && <p className="mt-1 line-clamp-2 text-muted">{project.topic}</p>}
          </div>
          <ProjectActions
            project={{ id: project.id, title: project.title, folderId: project.folderId }}
            folders={folders.map((f) => ({ id: f.id, name: f.name }))}
          />
        </div>
        <div className="mt-5">
          <ProjectTabs projectId={project.id} />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">{props.children}</div>
    </GenerationProvider>
  );
}
