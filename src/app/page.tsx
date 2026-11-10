import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Brain, Layers, ListChecks, Lock, MessagesSquare, Network, Repeat, ScrollText } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/dal";
import Logo from "./components/Logo";

const STEPS = [
  { title: "Start with anything", body: "Type a topic you want to learn, paste lecture notes, record a class, or drop a PDF or Word file. Uploading is optional." },
  { title: "Pick what to create", body: "Notes, a cheat sheet, flashcards, a quiz, a mind map or key terms. Choose one or all of them." },
  { title: "Study it properly", body: "Review cards when they're due, test yourself, and ask the tutor about anything you don't get." },
];

const FEATURES = [
  { icon: BookOpen, title: "Deep notes", body: "Definitions, how it works, analogies and the blind spots lecturers skip, with real math typesetting." },
  { icon: ScrollText, title: "Cheat sheets", body: "One dense page of key ideas, formulas and common mistakes for the night before." },
  { icon: Layers, title: "Flashcards", body: "Index cards you flip, plus spaced repetition that schedules each card right before you'd forget it." },
  { icon: ListChecks, title: "Quizzes", body: "Exam-style questions with instant feedback, explanations and your score history." },
  { icon: Network, title: "Mind maps", body: "See how every idea in a topic connects, then zoom and pan around it." },
  { icon: MessagesSquare, title: "A tutor that read your notes", body: "Ask follow-ups, get simpler explanations, or have it quiz you on the material." },
];

export default async function LandingPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login" className="btn btn-ghost">
            Log in
          </Link>
          <Link href="/signup" className="btn btn-primary">
            Get started
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div>
            <p className="eyebrow">Free · private · runs on your own AI</p>
            <h1 className="mt-4 text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
              Turn any topic into notes, flashcards and a <span className="highlight">tutor</span>.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              Type what you&apos;re studying or bring your lecture material. Get everything you need to understand it and remember it,
              organised into folders for each class.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="btn btn-primary px-5 py-2.5 text-[15px]">
                Create your study space
              </Link>
              <Link href="/login" className="btn btn-secondary px-5 py-2.5 text-[15px]">
                I have an account
              </Link>
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-faint">
              <Lock className="size-4" /> Your notes and questions never leave your own computer.
            </p>
          </div>

          {/* Study-desk illustration built from real UI pieces */}
          <div aria-hidden className="relative mx-auto h-[25rem] w-full max-w-md select-none">
            <div className="absolute top-2 left-0 w-[85%] -rotate-2 rounded-lg border border-line bg-surface p-5 shadow-sm">
              <p className="eyebrow">Notes · Thermodynamics</p>
              <p className="mt-3 font-serif text-[15px] leading-relaxed">
                <strong>Entropy</strong> measures how many microstates fit a macrostate:{" "}
                <span className="highlight">S = k ln W</span>.
              </p>
              <p className="mt-2 inline-flex rounded border border-bad/30 bg-bad-soft px-1.5 text-[11px] font-semibold tracking-wide text-bad uppercase">
                Blind spot
              </p>
              <p className="mt-1 font-serif text-sm text-muted">Entropy of a system can fall if the surroundings gain more.</p>
            </div>
            <div className="index-card absolute top-[13.25rem] right-0 h-32 w-[70%] rotate-2 rounded-lg border border-line p-4 shadow-md">
              <p className="text-[11px] font-semibold tracking-wide text-faint uppercase">Flashcard</p>
              <p className="mt-4 font-serif text-[15px] leading-[2rem]">Why can&apos;t a heat engine be 100% efficient?</p>
            </div>
            <div className="absolute -bottom-2 left-4 flex w-[58%] items-center gap-3 rounded-lg border border-good/30 bg-good-soft p-3 shadow-sm">
              <span className="grid size-7 place-items-center rounded-full bg-good text-xs font-bold text-white">B</span>
              <span className="text-sm">Correct: the Carnot limit</span>
            </div>
          </div>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-8 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title}>
                  <span className="font-mono text-sm text-accent">Step {i + 1}</span>
                  <h3 className="mt-1 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Everything a study session needs</h2>
          <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-accent" />
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-14 flex flex-col items-start gap-4 rounded-lg border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <Repeat className="mt-0.5 size-5 shrink-0 text-accent" />
              <div>
                <h3 className="font-semibold">Built to make it stick</h3>
                <p className="mt-1 text-sm text-muted">Spaced repetition tells you exactly which cards to review today, across all your classes.</p>
              </div>
            </div>
            <Link href="/signup" className="btn btn-primary shrink-0">
              <Brain className="size-4" /> Start studying
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-8 text-center text-sm text-faint">Superpower Study Suite · runs on your own private AI</footer>
    </div>
  );
}
