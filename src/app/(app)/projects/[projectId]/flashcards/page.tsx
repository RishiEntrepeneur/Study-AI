import Link from "next/link";
import { Repeat } from "lucide-react";
import { loadProject } from "@/lib/data/loaders";
import { countDueCards, listProjectCards } from "@/lib/data/study";
import { cardStage } from "@/lib/srs";
import FlashcardDeck from "../../../../components/FlashcardDeck";
import OutputGate, { GenerateButton } from "../../../../components/OutputGate";

export default async function FlashcardsPage(props: PageProps<"/projects/[projectId]/flashcards">) {
  const { projectId } = await props.params;
  const { user, project } = await loadProject(projectId);
  const [rows, due] = await Promise.all([listProjectCards(user.id, project.id), countDueCards(user.id, project.id)]);
  const cards = rows.map((c) => ({ id: c.id, question: c.question, answer: c.answer, stage: cardStage(c) }));
  const counts = { new: 0, learning: 0, review: 0, mastered: 0 };
  for (const c of cards) counts[c.stage]++;

  return (
    <OutputGate type="flashcards" hasContent={cards.length > 0}>
      {cards.length > 0 && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <FlashcardDeck cards={cards} />
          <aside className="space-y-5">
            <div className="card p-4">
              <p className="eyebrow">Spaced repetition</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{due}</p>
              <p className="text-sm text-muted">card{due === 1 ? "" : "s"} due now</p>
              {due > 0 ? (
                <Link href={`/review?project=${project.id}`} className="btn btn-primary mt-4 w-full">
                  <Repeat className="size-4" /> Review due cards
                </Link>
              ) : (
                <p className="mt-3 text-sm text-muted">All caught up. Cards come back right before you&apos;d forget them.</p>
              )}
            </div>
            <dl className="card divide-y divide-line text-sm">
              {(
                [
                  ["New", counts.new],
                  ["Learning", counts.learning],
                  ["Reviewing", counts.review],
                  ["Mastered", counts.mastered],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="flex justify-between px-4 py-2">
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-medium tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
            <GenerateButton
              type="flashcards"
              label="Regenerate cards"
              variant="secondary"
              confirmText="This replaces all cards and their review progress."
            />
          </aside>
        </div>
      )}
    </OutputGate>
  );
}
