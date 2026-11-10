"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Cpu, LayoutDashboard, LoaderCircle, ScanText, Square, type LucideIcon } from "lucide-react";
import type { ContextTier } from "@/lib/types";

export interface ProgressState {
  step: 1 | 2 | 3;
  tier: ContextTier;
  /** Client-side estimate until the server's plan arrives. */
  wordCount: number;
  segments: number;
  planned: boolean;
  segmentIndex: number;
  tokens: number;
  synthesizing: boolean;
  startedAt: number;
}

interface StepDef {
  title: string;
  icon: LucideIcon;
}

const STEPS: StepDef[] = [
  { title: "Step 1: Parsing Data & Handling Heavy Chunking...", icon: ScanText },
  { title: "Step 2: Feeding to Private AI Cluster...", icon: Cpu },
  { title: "Step 3: Rendering Interactive Dashboard...", icon: LayoutDashboard },
];

/** Rough tokens a segment produces; only used to animate the progress bar. */
const EXPECTED_TOKENS = { standard: 3_000, deep_dive: 5_000 } as const;

function progressOf(p: ProgressState): number {
  if (p.step === 1) return p.planned ? 10 : 4;
  if (p.step === 3) return 96;
  if (p.synthesizing) return 90;
  const within = Math.min(p.tokens / EXPECTED_TOKENS[p.tier], 0.95);
  return 10 + 78 * ((p.segmentIndex + within) / Math.max(1, p.segments));
}

function detailFor(index: number, p: ProgressState): string {
  if (index === 0) {
    if (!p.planned) return `Measuring ${p.wordCount.toLocaleString()} words and planning segments…`;
    return p.segments > 1
      ? `${p.wordCount.toLocaleString()} words → ${p.segments} chronological segments (≤ 8,000 words each)`
      : `${p.wordCount.toLocaleString()} words · fits in a single pass`;
  }
  if (index === 1) {
    if (p.step < 2) return p.tier === "deep_dive" ? "Deep Dive research protocol armed" : "Standard analytical tier";
    if (p.step > 2) return p.segments > 1 ? `${p.segments} segments analysed & synthesised` : "Analysis complete";
    if (p.synthesizing) return "Synthesising cross-segment master map…";
    const where = p.segments > 1 ? `Segment ${p.segmentIndex + 1} of ${p.segments}` : "Analysing lecture";
    return p.tokens > 0
      ? `${where} · ${p.tokens.toLocaleString()} tokens streamed`
      : `${where} · model is reading the material…`;
  }
  return p.step === 3 ? "Typesetting equations and drawing your mind map…" : "Notes · Flashcards · Quiz · Mind Map";
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Each step stays on screen at least this long, so fast transitions remain readable. */
const MIN_STEP_DWELL_MS = 650;

export default function ProcessingSteps({ progress, onCancel }: { progress: ProgressState; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [visibleStep, setVisibleStep] = useState<ProgressState["step"]>(1);
  const enteredAt = useRef(0);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Advance one step at a time, honouring the minimum dwell.
  useEffect(() => {
    if (progress.step <= visibleStep) return;
    if (!enteredAt.current) enteredAt.current = progress.startedAt;
    const wait = Math.max(0, MIN_STEP_DWELL_MS - (Date.now() - enteredAt.current));
    const timer = window.setTimeout(() => {
      enteredAt.current = Date.now();
      setVisibleStep((s) => (Math.min(s + 1, progress.step) as ProgressState["step"]));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [progress.step, progress.startedAt, visibleStep]);

  const shown: ProgressState = { ...progress, step: visibleStep };
  const pct = Math.round(progressOf(shown));

  return (
    <section className="glass mx-auto w-full max-w-2xl rounded-3xl p-6 sm:p-8 animate-card-in" aria-live="polite" aria-busy="true">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-violet-300 uppercase">Processing</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Building your Study Suite</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {progress.tier === "deep_dive" ? "Deep Dive" : "Standard"} tier · elapsed {formatElapsed(now - progress.startedAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-100"
        >
          <Square className="size-3.5" /> Cancel
        </button>
      </div>

      <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="relative h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        >
          <div className="shimmer-bar absolute inset-0" />
        </div>
      </div>

      <ol className="mt-8 space-y-3">
        {STEPS.map((step, i) => {
          const n = i + 1;
          const state = n < visibleStep ? "done" : n === visibleStep ? "active" : "pending";
          const Icon = step.icon;
          return (
            <li
              key={step.title}
              className={`relative flex gap-4 rounded-2xl border p-4 transition-all duration-500 ${
                state === "active"
                  ? "border-violet-400/40 bg-violet-500/[0.08] shadow-[0_0_40px_-12px_rgba(139,92,246,0.55)]"
                  : state === "done"
                    ? "border-emerald-400/20 bg-emerald-400/[0.04]"
                    : "border-white/5 bg-white/[0.015]"
              }`}
            >
              <div
                className={`grid size-10 shrink-0 place-items-center rounded-xl transition-colors ${
                  state === "done"
                    ? "bg-emerald-400/15 text-emerald-300"
                    : state === "active"
                      ? "bg-violet-500/20 text-violet-200"
                      : "bg-white/5 text-zinc-500"
                }`}
              >
                {state === "done" ? (
                  <Check className="size-5" />
                ) : state === "active" ? (
                  <LoaderCircle className="size-5 animate-spin" />
                ) : (
                  <Icon className="size-5" />
                )}
              </div>
              <div className="min-w-0">
                <p className={`font-medium ${state === "pending" ? "text-zinc-500" : "text-white"}`}>{step.title}</p>
                <p className={`mt-0.5 text-sm ${state === "active" ? "text-violet-200/90" : "text-zinc-500"}`}>
                  {detailFor(i, shown)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 text-center text-xs text-zinc-500">
        Large lectures can take a few minutes on the private cluster. You can keep this tab open in the background.
      </p>
    </section>
  );
}
