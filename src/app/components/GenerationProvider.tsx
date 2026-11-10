"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { GenerationStatusView, OutputType } from "@/lib/types";

interface GenerationContextValue {
  projectId: string;
  statuses: GenerationStatusView[];
  get: (type: OutputType) => GenerationStatusView | undefined;
  /** Queue outputs for (re)generation. Resolves to an error message, or null on success. */
  generate: (types: OutputType[]) => Promise<string | null>;
  refreshStatus: () => void;
}

const GenerationContext = createContext<GenerationContextValue | null>(null);

const POLL_MS = 1500;
const isBusy = (s: GenerationStatusView) => s.status === "queued" || s.status === "running";

export function GenerationProvider({
  projectId,
  initial,
  children,
}: {
  projectId: string;
  initial: GenerationStatusView[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState(initial);
  const [pollKey, setPollKey] = useState(0);
  const fingerprint = useRef(initial.map((s) => `${s.id}:${s.status}`).join("|"));

  // Server-rendered data wins whenever the page refreshes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt fresh server data
    setStatuses(initial);
    fingerprint.current = initial.map((s) => `${s.id}:${s.status}`).join("|");
  }, [initial]);

  const busy = statuses.some(isBusy);

  useEffect(() => {
    if (!busy && pollKey === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/status`, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { outputs: GenerationStatusView[] };
          setStatuses(data.outputs);
          const next = data.outputs.map((s) => `${s.id}:${s.status}`).join("|");
          if (next !== fingerprint.current) {
            fingerprint.current = next;
            router.refresh(); // pull the finished content into the server components
          }
          if (!data.outputs.some(isBusy)) return;
        }
      } catch {
        /* network blip: keep polling */
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, pollKey ? 50 : POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [busy, pollKey, projectId, router]);

  const get = useCallback((type: OutputType) => statuses.find((s) => s.type === type), [statuses]);

  const generate = useCallback(
    async (types: OutputType[]) => {
      try {
        const res = await fetch(`/api/projects/${projectId}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outputs: types }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          return data?.error ?? "Couldn't start. Please try again.";
        }
        // Optimistically show them as queued, then start polling.
        setStatuses((prev) => {
          const next = [...prev];
          for (const type of types) {
            const i = next.findIndex((s) => s.type === type);
            const entry: GenerationStatusView = {
              id: i >= 0 ? next[i].id : `pending-${type}`,
              type,
              status: "queued",
              error: null,
              hasContent: i >= 0 ? next[i].hasContent : false,
              progress: null,
            };
            if (i >= 0) next[i] = entry;
            else next.push(entry);
          }
          return next;
        });
        setPollKey((k) => k + 1);
        return null;
      } catch {
        return "Couldn't reach the server. Check your connection.";
      }
    },
    [projectId],
  );

  const refreshStatus = useCallback(() => setPollKey((k) => k + 1), []);

  return (
    <GenerationContext.Provider value={{ projectId, statuses, get, generate, refreshStatus }}>{children}</GenerationContext.Provider>
  );
}

export function useGenerations(): GenerationContextValue {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGenerations must be used inside <GenerationProvider>");
  return ctx;
}
