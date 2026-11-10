"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, CircleCheck, CircleX, Lightbulb, RotateCcw, Target, Trophy } from "lucide-react";
import { OPTION_LETTERS, type OptionLetter, type QuizQuestion } from "@/lib/types";
import MathMarkdown from "../MathMarkdown";

export default function QuizTab({ questions, active = true }: { questions: QuizQuestion[]; active?: boolean }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Array<OptionLetter | null>>(() => questions.map(() => null));
  const [showResults, setShowResults] = useState(false);
  const [lastGain, setLastGain] = useState(0); // key for the "+1" animation

  const score = useMemo(() => answers.filter((a, i) => a !== null && a === questions[i]?.correctAnswer).length, [answers, questions]);
  const answered = answers.filter((a) => a !== null).length;
  const accuracy = answered ? Math.round((score / answered) * 100) : 0;

  const question = questions[index];
  const selected = answers[index];
  const isAnswered = selected !== null;
  const isCorrect = isAnswered && selected === question?.correctAnswer;

  const choose = (letter: OptionLetter) => {
    if (isAnswered || !question) return;
    setAnswers((prev) => prev.map((a, i) => (i === index ? letter : a)));
    if (letter === question.correctAnswer) setLastGain((n) => n + 1);
  };

  const next = () => {
    if (index < questions.length - 1) setIndex(index + 1);
    else setShowResults(true);
  };

  const restart = () => {
    setAnswers(questions.map(() => null));
    setIndex(0);
    setShowResults(false);
    setLastGain(0);
  };

  useEffect(() => {
    if (showResults || !active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [role='tablist']")) return;
      const key = e.key.toUpperCase();
      const byNumber = ["1", "2", "3", "4"].indexOf(key);
      const byLetter = OPTION_LETTERS.indexOf(key as OptionLetter);
      const optionIndex = byNumber !== -1 ? byNumber : byLetter;
      if (optionIndex !== -1 && question && optionIndex < question.options.length) {
        choose(OPTION_LETTERS[optionIndex]);
      } else if ((e.key === "ArrowRight" || e.key === "Enter") && isAnswered && !target?.closest("button")) {
        next();
      } else if (e.key === "ArrowLeft" && index > 0) {
        setIndex(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!questions.length) {
    return <p className="py-16 text-center text-zinc-400">No quiz questions were generated for this material.</p>;
  }

  if (showResults) {
    const pct = Math.round((score / questions.length) * 100);
    const verdict =
      pct >= 90 ? "Superpower unlocked." : pct >= 70 ? "Strong grasp — polish the gaps." : pct >= 50 ? "Solid start — revisit the blind spots." : "Back to the Deep Notes, then retake.";
    const circumference = 2 * Math.PI * 52;
    return (
      <section className="glass mx-auto max-w-xl rounded-3xl p-8 text-center animate-card-in">
        <div className="relative mx-auto size-40">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="url(#quiz-grad)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct / 100)}
              className="transition-[stroke-dashoffset] duration-1000"
            />
            <defs>
              <linearGradient id="quiz-grad" x1="0" x2="1">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div>
              <p className="text-4xl font-bold text-white">{pct}%</p>
              <p className="text-xs text-zinc-400">
                {score} / {questions.length} correct
              </p>
            </div>
          </div>
        </div>
        <h3 className="mt-6 flex items-center justify-center gap-2 text-xl font-semibold text-white">
          <Trophy className="size-5 text-amber-300" /> {verdict}
        </h3>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={restart} className="toolbar-btn px-4 py-2.5">
            <RotateCcw className="size-4" /> Retake quiz
          </button>
          <button
            type="button"
            onClick={() => {
              setShowResults(false);
              setIndex(0);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Review answers <ArrowRight className="size-4" />
          </button>
        </div>
      </section>
    );
  }

  const correctIndex = OPTION_LETTERS.indexOf(question.correctAnswer);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <section key={index} className="glass rounded-3xl p-5 sm:p-8 animate-card-in" aria-labelledby="quiz-question">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-violet-200 uppercase">
            Question {index + 1} of {questions.length}
          </span>
          <span className="hidden text-xs text-zinc-500 sm:inline">Press 1–4 or A–D to answer</span>
        </div>

        <div id="quiz-question" className="mt-5 text-lg leading-relaxed font-medium text-white sm:text-xl">
          <MathMarkdown className="prose prose-invert max-w-none prose-p:my-1 prose-strong:text-violet-200">{question.question}</MathMarkdown>
        </div>

        <div className="mt-6 grid gap-3" role="group" aria-label="Answer options">
          {question.options.map((option, i) => {
            const letter = OPTION_LETTERS[i];
            const isRight = i === correctIndex;
            const isPicked = selected === letter;
            let style = "border-white/10 bg-white/[0.03] hover:border-violet-400/50 hover:bg-violet-500/[0.07]";
            let badge = "bg-white/10 text-zinc-300";
            if (isAnswered) {
              if (isRight) {
                style = "border-emerald-400/70 bg-emerald-500/15 shadow-[0_0_30px_-10px_rgba(16,185,129,0.7)]";
                badge = "bg-emerald-400 text-emerald-950";
              } else if (isPicked) {
                style = "border-rose-500/70 bg-rose-600/15 shadow-[0_0_30px_-10px_rgba(225,29,72,0.7)]";
                badge = "bg-rose-500 text-white";
              } else {
                style = "border-white/5 bg-white/[0.015] opacity-50";
              }
            }
            return (
              <button
                key={letter}
                type="button"
                onClick={() => choose(letter)}
                disabled={isAnswered}
                aria-pressed={isPicked}
                className={`group flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-all duration-300 disabled:cursor-default ${style}`}
              >
                <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-sm font-bold transition-colors ${badge}`}>
                  {letter}
                </span>
                <MathMarkdown inline className="flex-1 pt-0.5 text-[15px] leading-relaxed text-zinc-100">
                  {option}
                </MathMarkdown>
                {isAnswered && isRight && <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-300" aria-label="Correct answer" />}
                {isAnswered && isPicked && !isRight && <CircleX className="mt-0.5 size-5 shrink-0 text-rose-400" aria-label="Your answer" />}
              </button>
            );
          })}
        </div>

        {isAnswered && (
          <div
            role="status"
            className={`mt-6 rounded-2xl border-l-4 p-4 sm:p-5 animate-fade-up ${
              isCorrect ? "border-emerald-400 bg-emerald-500/10" : "border-rose-500 bg-rose-600/10"
            }`}
          >
            <p className={`flex items-center gap-2 font-semibold ${isCorrect ? "text-emerald-200" : "text-rose-200"}`}>
              {isCorrect ? <CircleCheck className="size-5" /> : <CircleX className="size-5" />}
              {isCorrect ? "Correct!" : `Not quite — the answer is ${question.correctAnswer}.`}
            </p>
            {question.explanation && (
              <div className="mt-3 flex gap-3 text-sm leading-relaxed text-zinc-200">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
                <MathMarkdown className="prose prose-sm prose-invert max-w-none prose-p:my-1">{question.explanation}</MathMarkdown>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0} className="toolbar-btn px-4 py-2.5">
            <ChevronLeft className="size-4" /> Previous
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!isAnswered}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(168,85,247,0.8)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {index === questions.length - 1 ? "See results" : "Next question"} <ArrowRight className="size-4" />
          </button>
        </div>
      </section>

      {/* Scoreboard */}
      <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start" aria-label="Scoreboard">
        <div className="glass relative overflow-hidden rounded-3xl p-5">
          <div className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-amber-400/10 blur-2xl" />
          <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-zinc-400 uppercase">
            <Trophy className="size-3.5 text-amber-300" /> Scoreboard
          </p>
          <div className="relative mt-3 flex items-end gap-2">
            <span key={`score-${score}`} className="inline-block text-5xl font-bold text-white tabular-nums animate-pop" aria-live="polite">
              {score}
            </span>
            <span className="mb-1.5 text-sm text-zinc-400">/ {answered} answered</span>
            {lastGain > 0 && (
              <span key={`gain-${lastGain}`} className="absolute top-0 left-10 text-lg font-bold text-emerald-300 animate-float-up" aria-hidden>
                +1
              </span>
            )}
          </div>
          <div className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
            <Target className="size-4 text-cyan-300" /> Accuracy <span className="ml-auto font-semibold tabular-nums">{accuracy}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-[width] duration-500" style={{ width: `${accuracy}%` }} />
          </div>
        </div>

        <div className="glass rounded-3xl p-5">
          <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-zinc-400 uppercase">Progress</p>
          <div className="flex flex-wrap gap-2">
            {questions.map((q, i) => {
              const a = answers[i];
              const tone =
                a === null ? "bg-white/5 text-zinc-400" : a === q.correctAnswer ? "bg-emerald-500/25 text-emerald-200" : "bg-rose-500/25 text-rose-200";
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Go to question ${i + 1}`}
                  aria-current={i === index ? "step" : undefined}
                  className={`size-8 rounded-lg text-xs font-semibold transition ${tone} ${i === index ? "ring-2 ring-violet-400" : "hover:brightness-125"}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
