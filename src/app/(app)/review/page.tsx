import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { dueCards, nextDueAt } from "@/lib/data/study";
import { describeDue } from "@/lib/srs";
import ReviewSession from "../../components/ReviewSession";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage(props: PageProps<"/review">) {
  const user = await requireUser();
  const { project } = await props.searchParams;
  const projectId = typeof project === "string" ? project : undefined;
  const [cards, next] = await Promise.all([dueCards(user.id, { projectId }), nextDueAt(user.id)]);
  const nextDue = describeDue(next);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
      <p className="mt-1 mb-6 text-muted">
        {cards.length > 0
          ? `${cards.length} card${cards.length === 1 ? "" : "s"} due${projectId ? " in this project" : " across all your projects"}. Rate honestly; it decides when each card comes back.`
          : "Cards appear here on the day you're about to forget them."}
      </p>
      <ReviewSession
        key={cards.map((c) => c.id).join(",")}
        nextDue={nextDue}
        cards={cards.map((c) => ({
          id: c.id,
          question: c.question,
          answer: c.answer,
          projectId: c.projectId,
          projectTitle: c.projectTitle,
          intervalDays: c.intervalDays,
          ease: c.ease,
          reps: c.reps,
          lapses: c.lapses,
        }))}
      />
    </div>
  );
}
