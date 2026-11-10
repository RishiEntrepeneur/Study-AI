import { loadProject } from "@/lib/data/loaders";
import { parseContent } from "@/lib/data/projects";
import NotesView from "../../../../components/NotesView";
import OutputGate from "../../../../components/OutputGate";

export default async function CheatSheetPage(props: PageProps<"/projects/[projectId]/cheatsheet">) {
  const { projectId } = await props.params;
  const { project, generations } = await loadProject(projectId);
  const content = parseContent(generations.find((g) => g.type === "cheatsheet"), "cheatsheet");
  return (
    <OutputGate type="cheatsheet" hasContent={Boolean(content)}>
      {content && <NotesView projectId={project.id} type="cheatsheet" title={project.title} markdown={content.markdown} />}
    </OutputGate>
  );
}
