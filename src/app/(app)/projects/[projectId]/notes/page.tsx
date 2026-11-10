import { loadProject } from "@/lib/data/loaders";
import { parseContent } from "@/lib/data/projects";
import NotesView from "../../../../components/NotesView";
import OutputGate from "../../../../components/OutputGate";

export default async function NotesPage(props: PageProps<"/projects/[projectId]/notes">) {
  const { projectId } = await props.params;
  const { project, generations } = await loadProject(projectId);
  const content = parseContent(generations.find((g) => g.type === "notes"), "notes");
  return (
    <OutputGate type="notes" hasContent={Boolean(content)}>
      {content && <NotesView projectId={project.id} type="notes" title={project.title} markdown={content.markdown} />}
    </OutputGate>
  );
}
