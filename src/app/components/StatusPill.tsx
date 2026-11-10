"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "online" | "offline" | "model_missing" | "misconfigured";

const LABELS: Record<Status, string> = {
  checking: "Checking AI…",
  online: "AI ready",
  offline: "AI offline",
  model_missing: "Model not installed",
  misconfigured: "AI not configured",
};

const DOT: Record<Status, string> = {
  checking: "bg-faint",
  online: "bg-good",
  offline: "bg-warn",
  model_missing: "bg-warn",
  misconfigured: "bg-bad",
};

export interface HealthInfo {
  status: Status;
  model?: string;
  installedModels?: string[];
}

export function useHealth(intervalMs = 30_000): HealthInfo {
  const [info, setInfo] = useState<HealthInfo>({ status: "checking" });
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as HealthInfo;
        if (!cancelled) setInfo({ ...data, status: data.status in LABELS ? data.status : res.ok ? "online" : "offline" });
      } catch {
        if (!cancelled) setInfo({ status: "offline" });
      }
    };
    void probe();
    const timer = window.setInterval(probe, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [intervalMs]);
  return info;
}

export default function StatusPill() {
  const { status, model } = useHealth();
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted" role="status" aria-live="polite">
      <span className={`size-2 shrink-0 rounded-full ${DOT[status]}`} />
      <span className="truncate">
        {LABELS[status]}
        {model && status === "online" && <span className="text-faint"> · {model}</span>}
      </span>
    </div>
  );
}
