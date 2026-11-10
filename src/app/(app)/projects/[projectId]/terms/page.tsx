import { loadProject } from "@/lib/data/loaders";
import { parseContent } from "@/lib/data/projects";
import OutputGate, { GenerateButton } from "../../../../components/OutputGate";
import TermsView from "../../../../components/TermsView";

export default async function TermsPage(props: PageProps<"/projects/[projectId]/terms">) {
  const { projectId } = await props.params;
  const { generations } = await loadProject(projectId);
  const content = parseContent(generations.find((g) => g.type === "terms"), "terms");
  return (
    <OutputGate type="terms" hasContent={Boolean(content?.terms.length)}>
      {content && (
        <div className="space-y-8">
          <TermsView terms={content.terms} />
          <GenerateButton type="terms" label="Regenerate terms" variant="secondary" />
        </div>
      )}
    </OutputGate>
  );
}
