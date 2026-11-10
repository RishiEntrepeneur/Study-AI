import { loadProject } from "@/lib/data/loaders";
import { parseContent } from "@/lib/data/projects";
import MindMap from "../../../../components/MindMap";
import OutputGate, { GenerateButton } from "../../../../components/OutputGate";

export default async function MindMapPage(props: PageProps<"/projects/[projectId]/mindmap">) {
  const { projectId } = await props.params;
  const { project, generations } = await loadProject(projectId);
  const content = parseContent(generations.find((g) => g.type === "mindmap"), "mindmap");
  const notes = parseContent(generations.find((g) => g.type === "notes"), "notes")?.markdown ?? "";
  return (
    <OutputGate type="mindmap" hasContent={Boolean(content)}>
      {content && (
        <div className="space-y-4">
          <MindMap code={content.code} title={project.title} notes={notes} />
          <GenerateButton type="mindmap" label="Regenerate map" variant="secondary" />
        </div>
      )}
    </OutputGate>
  );
}
