"use client";

import { useState, useTransition, type ReactNode } from "react";
import { CircleAlert, RefreshCw, Sparkles, X } from "lucide-react";
import { cancelGeneration } from "../actions/library";
import { outputInfo } from "@/lib/outputs";
import type { GenerationStatusView, OutputType } from "@/lib/types";
import { useGenerations } from "./GenerationProvider";
import OutputIcon from "./OutputIcon";
import Spinner from "./Spinner";

const ITEM_WORDS: Partial<Record<OutputType, [string, string]>> = {
  flashcards: ["card", "cards"],
  quiz: ["question", "questions"],
  terms: ["term", "terms"],
};

function progressText(s: GenerationStatusView): string {
  if (s.status === "queued") return "Waiting in line…";
  const p = s.progress;
  if (!p) return "Starting…";
  if (p.note) return p.note;
  const part = p.parts > 1 ? `Part ${p.part} of ${p.parts} · ` : "";
  if (p.tokens === 0) return `${part}reading…`;
  const item = ITEM_WORDS[s.type];
  if (item && p.items !== undefined) return `${part}${p.items} ${p.items === 1 ? item[0] : item[1]} written so far`;
  if (p.words !== undefined) return `${part}${p.words.toLocaleString()} words written so far`;
  return `${part}writing…`;
}

export function GenerateButton({
  type,
  label,
  variant = "primary",
  confirmText,
}: {
  type: OutputType;
  label?: string;
  variant?: "primary" | "secondary";
  confirmText?: string;
}) {
  const { generate } = useGenerations();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = () =>
    start(async () => {
      setError(null);
      setConfirming(false);
      setError(await generate([type]));
    });

  if (confirming && confirmText) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{confirmText}</span>
        <button type="button" onClick={run} className="btn btn-primary btn-sm">
          Yes, regenerate
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => (confirmText ? setConfirming(true) : run())}
        className={`btn ${variant === "primary" ? "btn-primary" : "btn-secondary btn-sm"}`}
      >
        {pending ? <Spinner /> : variant === "primary" ? <Sparkles className="size-4" /> : <RefreshCw className="size-3.5" />}
        {label ?? `Create ${outputInfo(type).label.toLowerCase()}`}
      </button>
      {error && <span className="text-sm text-bad">{error}</span>}
    </span>
  );
}

function ProgressCard({ status, compact }: { status: GenerationStatusView; compact?: boolean }) {
  const [pending, start] = useTransition();
  const { refreshStatus } = useGenerations();
  const info = outputInfo(status.type);
  return (
    <div className={`card flex items-center gap-4 ${compact ? "px-4 py-3" : "px-5 py-6"}`} role="status" aria-live="polite">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        <Spinner className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {status.hasContent ? `Making a new version of your ${info.label.toLowerCase()}` : `Creating your ${info.label.toLowerCase()}`}
        </p>
        <p className="mt-0.5 text-sm text-muted">{progressText(status)}</p>
        {!compact && status.progress?.preview && (
          <div className="mt-3 rounded-lg border border-line bg-subtle px-3 py-2">
            <p className="mb-1 text-xs font-medium text-muted">Writing now (you can start reading):</p>
            {/* Newest text at the bottom; older lines fade out at the top. */}
            <div className="relative flex max-h-56 flex-col justify-end overflow-hidden">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{status.progress.preview}</p>
              <span className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-subtle to-transparent" aria-hidden />
            </div>
          </div>
        )}
      </div>
      {!status.id.startsWith("pending-") && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await cancelGeneration(status.id);
              refreshStatus();
            })
          }
          className="btn btn-ghost btn-sm"
        >
          <X className="size-3.5" /> Stop
        </button>
      )}
    </div>
  );
}

/** Wraps an output page: shows the right state (empty, working, failed) around the content. */
export default function OutputGate({ type, hasContent, children }: { type: OutputType; hasContent: boolean; children?: ReactNode }) {
  const { get } = useGenerations();
  const status = get(type);
  const info = outputInfo(type);
  const busy = status && (status.status === "queued" || status.status === "running");

  if (busy && !hasContent) return <ProgressCard status={status} />;

  if (!hasContent) {
    return (
      <div className="space-y-4">
        {status?.status === "error" && status.error && <ErrorNote message={status.error} />}
        <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-subtle text-muted">
            <OutputIcon type={type} className="size-5" />
          </span>
          <p className="mt-4 font-medium">{status?.status === "error" ? `Your ${info.label.toLowerCase()} couldn't be created` : `No ${info.label.toLowerCase()} yet`}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{info.description}.</p>
          <div className="mt-5 flex justify-center">
            <GenerateButton type={type} label={status?.status === "error" ? "Try again" : undefined} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {busy && <ProgressCard status={status} compact />}
      {status?.status === "error" && status.error && <ErrorNote message={`The new version failed, so you're seeing the previous one. ${status.error}`} />}
      {children}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-bad/25 bg-bad-soft px-4 py-3 text-sm text-ink">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
      <p>{message}</p>
    </div>
  );
}
