import Link from "next/link";
import type { ProjectSummary } from "@/lib/data/projects";
import { timeAgo } from "@/lib/format";
import { OUTPUTS } from "@/lib/outputs";
import OutputIcon from "./OutputIcon";

export default function ProjectList({ projects, folderNames }: { projects: ProjectSummary[]; folderNames?: Record<string, string> }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {projects.map((p) => {
        const ordered = OUTPUTS.filter((o) => p.outputs.some((x) => x.type === o.type));
        const busy = p.outputs.some((o) => o.status === "queued" || o.status === "running");
        const failed = p.outputs.some((o) => o.status === "error");
        return (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-subtle">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.title}</p>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {folderNames && p.folderId && folderNames[p.folderId] ? `${folderNames[p.folderId]} · ` : ""}
                  {busy ? "Creating…" : failed ? "Something needs a retry" : `Updated ${timeAgo(p.updatedAt)}`}
                </p>
              </div>
              <div className="hidden items-center gap-1.5 text-faint sm:flex" aria-label="Outputs">
                {ordered.map((o) => {
                  const status = p.outputs.find((x) => x.type === o.type)?.status;
                  return (
                    <span
                      key={o.type}
                      title={`${o.label}: ${status}`}
                      className={status === "done" ? "text-muted" : status === "error" ? "text-bad" : "animate-pulse text-faint"}
                    >
                      <OutputIcon type={o.type} />
                    </span>
                  );
                })}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
