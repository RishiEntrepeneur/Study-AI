"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "online" | "offline" | "model_missing" | "misconfigured";

const LABELS: Record<Status, string> = {
  checking: "Connecting to private AI…",
  online: "Private AI online",
  offline: "AI server warming up",
  model_missing: "AI model loading",
  misconfigured: "AI server misconfigured",
};

const DOT: Record<Status, string> = {
  checking: "bg-zinc-400",
  online: "bg-emerald-400",
  offline: "bg-amber-400",
  model_missing: "bg-amber-400",
  misconfigured: "bg-rose-400",
};

export default function StatusPill() {
  const [status, setStatus] = useState<Status>("checking");
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as { status?: Status; model?: string };
        if (cancelled) return;
        setStatus(data.status && data.status in LABELS ? data.status : res.ok ? "online" : "offline");
        setModel(data.model ?? null);
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    probe();
    const timer = window.setInterval(probe, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div
      className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-2">
        {status === "online" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" />}
        <span className={`relative inline-flex size-2 rounded-full ${DOT[status]}`} />
      </span>
      <span className="hidden sm:inline">{LABELS[status]}</span>
      {model && status === "online" && (
        <span className="hidden rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 md:inline">{model}</span>
      )}
    </div>
  );
}
