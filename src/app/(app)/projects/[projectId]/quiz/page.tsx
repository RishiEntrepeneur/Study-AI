import { loadProject } from "@/lib/data/loaders";
import { parseContent } from "@/lib/data/projects";
import { listQuizAttempts } from "@/lib/data/study";
import { timeAgo } from "@/lib/format";
import OutputGate, { GenerateButton } from "../../../../components/OutputGate";
import QuizRunner from "../../../../components/QuizRunner";

export default async function QuizPage(props: PageProps<"/projects/[projectId]/quiz">) {
  const { projectId } = await props.params;
  const { user, project, generations } = await loadProject(projectId);
  const content = parseContent(generations.find((g) => g.type === "quiz"), "quiz");
  const attempts = content ? await listQuizAttempts(user.id, project.id) : [];
  const best = attempts.reduce((m, a) => Math.max(m, Math.round((a.score / a.total) * 100)), 0);

  return (
    <OutputGate type="quiz" hasContent={Boolean(content?.questions.length)}>
      {content && (
        <div className="space-y-8">
          <QuizRunner key={generations.find((g) => g.type === "quiz")?.finishedAt?.getTime() ?? 0} projectId={project.id} questions={content.questions} />
          <div className="flex flex-wrap items-start justify-between gap-6 border-t border-line pt-6">
            <div>
              <h2 className="font-semibold">Your attempts</h2>
              {attempts.length ? (
                <>
                  <p className="mt-1 text-sm text-muted">Best score: {best}%</p>
                  <ul className="mt-3 flex flex-wrap gap-2 text-sm">
                    {attempts.slice(0, 8).map((a) => (
                      <li key={a.id} className="rounded-md border border-line bg-surface px-2.5 py-1">
                        <span className="font-medium tabular-nums">
                          {a.score}/{a.total}
                        </span>{" "}
                        <span className="text-faint">· {timeAgo(a.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted">Finish the quiz to record your first score.</p>
              )}
            </div>
            <GenerateButton type="quiz" label="New questions" variant="secondary" />
          </div>
        </div>
      )}
    </OutputGate>
  );
}
