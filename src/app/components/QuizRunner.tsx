"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronLeft, CircleCheck, CircleX, Lightbulb, RotateCcw } from "lucide-react";
import { saveQuizAttempt } from "../actions/library";
import { OPTION_LETTERS, type OptionLetter, type QuizQuestion } from "@/lib/types";
import MathMarkdown from "./MathMarkdown";

export default function QuizRunner({ projectId, questions }: { projectId: string; questions: QuizQuestion[] }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Array<OptionLetter | null>>(() => questions.map(() => null));
  const [finished, setFinished] = useState(false);
  const [gain, setGain] = useState(0);
  const saved = useRef(false);

  const score = useMemo(() => answers.filter((a, i) => a !== null && a === questions[i]?.correctAnswer).length, [answers, questions]);
  const answered = answers.filter((a) => a !== null).length;
  const q = questions[index];
  const selected = answers[index];
  const isAnswered = selected !== null;
  const correctIndex = q ? OPTION_LETTERS.indexOf(q.correctAnswer) : -1;

  const choose = useCallback(
    (letter: OptionLetter) => {
      if (!q || answers[index] !== null) return;
      setAnswers((prev) => prev.map((a, i) => (i === index ? letter : a)));
      if (letter === q.correctAnswer) setGain((g) => g + 1);
    },
    [answers, index, q],
  );

  const finish = useCallback(() => {
    setFinished(true);
    if (!saved.current) {
      saved.current = true;
      void saveQuizAttempt(projectId, score, questions.length).then(() => router.refresh());
    }
  }, [projectId, questions.length, router, score]);

  const next = useCallback(() => {
    if (index < questions.length - 1) setIndex(index + 1);
    else finish();
  }, [finish, index, questions.length]);

  const restart = () => {
    setAnswers(questions.map(() => null));
    setIndex(0);
    setFinished(false);
    setGain(0);
    saved.current = false;
  };

  useEffect(() => {
    if (finished) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select")) return;
      const key = e.key.toUpperCase();
      const i = ["1", "2", "3", "4"].includes(key) ? Number(key) - 1 : OPTION_LETTERS.indexOf(key as OptionLetter);
      if (i >= 0 && q && i < q.options.length) choose(OPTION_LETTERS[i]);
      else if ((e.key === "Enter" || e.key === "ArrowRight") && isAnswered && !t?.closest("button")) next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, finished, isAnswered, next, q]);

  if (finished) {
    const pct = Math.round((score / questions.length) * 100);
    const verdict = pct >= 90 ? "Excellent. You know this." : pct >= 70 ? "Solid. Review the ones you missed." : pct >= 50 ? "Getting there. The notes will help." : "Worth another pass through the notes.";
    return (
      <div className="card mx-auto max-w-lg px-6 py-10 text-center animate-fade-in">
        <p className="eyebrow">Your score</p>
        <p className="mt-2 text-5xl font-semibold tabular-nums">{pct}%</p>
        <p className="mt-1 text-muted">
          {score} of {questions.length} correct
        </p>
        <p className="mt-4 font-medium">{verdict}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setFinished(false);
              setIndex(0);
            }}
            className="btn btn-secondary"
          >
            Review answers
          </button>
          <button type="button" onClick={restart} className="btn btn-primary">
            <RotateCcw className="size-4" /> Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <section key={index} className="card p-5 sm:p-7 animate-fade-in" aria-labelledby="quiz-q">
        <p className="eyebrow">
          Question {index + 1} of {questions.length}
        </p>
        <div id="quiz-q" className="mt-3 text-lg leading-relaxed font-medium">
          <MathMarkdown className="prose max-w-none dark:prose-invert prose-p:my-1 prose-strong:text-ink">{q.question}</MathMarkdown>
        </div>

        <div className="mt-5 grid gap-2.5" role="group" aria-label="Answer options">
          {q.options.map((option, i) => {
            const letter = OPTION_LETTERS[i];
            const right = i === correctIndex;
            const picked = selected === letter;
            let row = "border-line bg-surface hover:border-faint hover:bg-subtle";
            let bubble = "border-line text-muted";
            if (isAnswered) {
              if (right) {
                row = "border-good bg-good-soft";
                bubble = "border-good bg-good text-white";
              } else if (picked) {
                row = "border-bad bg-bad-soft";
                bubble = "border-bad bg-bad text-white";
              } else {
                row = "border-line bg-surface opacity-55";
              }
            }
            return (
              <button
                key={letter}
                type="button"
                onClick={() => choose(letter)}
                disabled={isAnswered}
                aria-pressed={picked}
                className={`flex w-full items-start gap-3 rounded-md border px-3.5 py-3 text-left transition-colors disabled:cursor-default ${row}`}
              >
                <span className={`grid size-7 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold ${bubble}`}>{letter}</span>
                <MathMarkdown inline className="flex-1 pt-0.5 text-[15px] leading-relaxed">
                  {option}
                </MathMarkdown>
                {isAnswered && right && <CircleCheck className="mt-0.5 size-5 shrink-0 text-good" aria-label="Correct answer" />}
                {isAnswered && picked && !right && <CircleX className="mt-0.5 size-5 shrink-0 text-bad" aria-label="Your answer" />}
              </button>
            );
          })}
        </div>

        {isAnswered && (
          <div role="status" className={`mt-5 rounded-md border-l-4 px-4 py-3 animate-fade-in ${selected === q.correctAnswer ? "border-good bg-good-soft" : "border-bad bg-bad-soft"}`}>
            <p className={`font-semibold ${selected === q.correctAnswer ? "text-good" : "text-bad"}`}>
              {selected === q.correctAnswer ? "Correct" : `Not quite. The answer is ${q.correctAnswer}.`}
            </p>
            {q.explanation && (
              <div className="mt-2 flex gap-2.5 text-sm leading-relaxed">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                <MathMarkdown className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1">{q.explanation}</MathMarkdown>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0} className="btn btn-ghost">
            <ChevronLeft className="size-4" /> Previous
          </button>
          <button type="button" onClick={next} disabled={!isAnswered} className="btn btn-primary">
            {index === questions.length - 1 ? "See results" : "Next"} <ArrowRight className="size-4" />
          </button>
        </div>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start" aria-label="Score">
        <div className="card relative p-4">
          <p className="eyebrow">Score</p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span key={score} className="inline-block text-3xl font-semibold tabular-nums animate-pop">
              {score}
            </span>
            <span className="text-sm text-muted">/ {answered} answered</span>
          </p>
          {gain > 0 && (
            <span key={gain} className="absolute top-3 right-4 text-sm font-semibold text-good animate-rise" aria-hidden>
              +1
            </span>
          )}
        </div>
        <div className="card p-4">
          <p className="eyebrow mb-2">Questions</p>
          <div className="flex flex-wrap gap-1.5">
            {questions.map((qq, i) => {
              const a = answers[i];
              const tone = a === null ? "border-line text-muted" : a === qq.correctAnswer ? "border-good bg-good text-white" : "border-bad bg-bad text-white";
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Question ${i + 1}`}
                  aria-current={i === index ? "step" : undefined}
                  className={`grid size-7 place-items-center rounded-full border text-xs font-semibold ${tone} ${i === index ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-faint">Keys: 1–4 or A–D to answer, Enter for next.</p>
        </div>
      </aside>
    </div>
  );
}
