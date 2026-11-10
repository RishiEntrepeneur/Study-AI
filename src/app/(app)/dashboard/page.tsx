import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FolderPlus } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { listFolders, listProjects } from "@/lib/data/projects";
import { studyStats } from "@/lib/data/study";
import { folderHex } from "@/lib/folderColors";
import { firstName } from "@/lib/format";
import CreateProjectForm from "../../components/CreateProjectForm";
import ProjectList from "../../components/ProjectList";

export const metadata: Metadata = { title: "Home" };

export default async function DashboardPage() {
  const user = await requireUser();
  const [folders, recent, stats] = await Promise.all([listFolders(user.id), listProjects(user.id, { limit: 8 }), studyStats(user.id)]);
  const folderNames = Object.fromEntries(folders.map((f) => [f.id, f.name]));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {firstName(user.name)}</h1>
          <p className="mt-1 text-muted">
            {stats.dueCards > 0
              ? `You have ${stats.dueCards} flashcard${stats.dueCards === 1 ? "" : "s"} to review today.`
              : stats.projects > 0
                ? "You're all caught up on reviews. Start something new or keep going."
                : "Start by telling me what you want to learn."}
          </p>
        </div>
        {stats.dueCards > 0 && (
          <Link href="/review" className="btn btn-primary">
            Review {stats.dueCards} card{stats.dueCards === 1 ? "" : "s"} <ArrowRight className="size-4" />
          </Link>
        )}
      </header>

      {stats.projects > 0 && (
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
          {[
            { label: "Due today", value: stats.dueCards },
            { label: "Cards mastered", value: `${stats.mastered} / ${stats.cards}` },
            { label: "Quiz average", value: stats.quizAverage === null ? "—" : `${stats.quizAverage}%` },
            { label: "Projects", value: stats.projects },
          ].map((s) => (
            <div key={s.label} className="bg-surface px-4 py-3">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section aria-labelledby="new-heading" className="card h-fit p-5 sm:p-6">
          <h2 id="new-heading" className="mb-5 text-lg font-semibold">
            Start a new project
          </h2>
          <CreateProjectForm folders={folders.map((f) => ({ id: f.id, name: f.name }))} compact />
        </section>

        <section aria-labelledby="recent-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="recent-heading" className="text-lg font-semibold">
              Recent projects
            </h2>
          </div>
          {recent.length > 0 ? (
            <ProjectList projects={recent} folderNames={folderNames} />
          ) : (
            <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
              <p className="font-medium">No projects yet</p>
              <p className="mt-1 text-sm text-muted">Your first one will show up here once you create it.</p>
            </div>
          )}

          <div className="mt-8 mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Folders</h2>
          </div>
          {folders.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {folders.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/folders/${f.id}`}
                    className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 transition-colors hover:bg-subtle"
                  >
                    <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: folderHex(f.color) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{f.name}</span>
                      <span className="text-xs text-muted">
                        {f.projectCount} project{f.projectCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
              <FolderPlus className="size-4 shrink-0" /> Create folders from the sidebar to keep each class separate.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
