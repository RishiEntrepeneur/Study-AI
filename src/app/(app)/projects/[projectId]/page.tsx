import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { loadProject } from "@/lib/data/loaders";
import { OUTPUTS } from "@/lib/outputs";
import { timeAgo } from "@/lib/format";
import DepthSetting from "../../../components/DepthSetting";
import GenerateMore from "../../../components/GenerateMore";
import MaterialsPanel from "../../../components/MaterialsPanel";
import OutputIcon from "../../../components/OutputIcon";
import Spinner from "../../../components/Spinner";

export default async function ProjectOverviewPage(props: PageProps<"/projects/[projectId]">) {
  const { projectId } = await props.params;
  const { project, materials, statuses } = await loadProject(projectId);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-10">
        <section aria-labelledby="outputs-heading">
          <h2 id="outputs-heading" className="mb-3 text-lg font-semibold">
            Study materials
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {OUTPUTS.map((o) => {
              const s = statuses.find((x) => x.type === o.type);
              const busy = s?.status === "queued" || s?.status === "running";
              const state = !s
                ? { text: "Not created", tone: "text-faint" }
                : busy
                  ? { text: s.status === "queued" ? "Waiting in line…" : "Creating…", tone: "text-accent" }
                  : s.status === "error"
                    ? { text: s.hasContent ? "Update failed" : "Failed: open to retry", tone: "text-bad" }
                    : s.hasContent
                      ? { text: "Ready", tone: "text-good" }
                      : { text: "Stopped", tone: "text-faint" };
              return (
                <li key={o.type}>
                  <Link
                    href={`/projects/${project.id}/${o.path}`}
                    className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:bg-subtle"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-subtle text-muted">
                      <OutputIcon type={o.type} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className={`flex items-center gap-1 text-xs ${state.tone}`}>
                        {busy && <Spinner className="size-3" />}
                        {s?.status === "done" && s.hasContent && <CircleCheck className="size-3" />}
                        {s?.status === "error" && <CircleAlert className="size-3" />}
                        {state.text}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="more-heading">
          <h2 id="more-heading" className="mb-1 text-lg font-semibold">
            Create more
          </h2>
          <p className="mb-4 text-sm text-muted">Pick anything you haven&apos;t made yet, or redo something with your latest material.</p>
          <GenerateMore />
        </section>
      </div>

      <aside className="space-y-10">
        <section aria-labelledby="materials-heading">
          <h2 id="materials-heading" className="mb-3 text-lg font-semibold">
            Material
          </h2>
          <MaterialsPanel
            projectId={project.id}
            materials={materials.map((m) => ({
              id: m.id,
              kind: m.kind,
              name: m.name,
              wordCount: m.wordCount,
              createdAt: m.createdAt.getTime(),
              preview: m.content.slice(0, 1200),
            }))}
          />
        </section>
        <section aria-labelledby="settings-heading">
          <h2 id="settings-heading" className="mb-3 text-lg font-semibold">
            Settings
          </h2>
          <DepthSetting projectId={project.id} tier={project.tier} />
          <p className="mt-6 text-xs text-faint">Created {timeAgo(project.createdAt)}</p>
        </section>
      </aside>
    </div>
  );
}
