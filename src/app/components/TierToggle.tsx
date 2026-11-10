"use client";

import { Telescope, Zap } from "lucide-react";
import type { ContextTier } from "@/lib/types";

const OPTIONS = [
  { value: "standard" as const, label: "Standard", hint: "Clear, exam-ready coverage", icon: Zap },
  { value: "deep_dive" as const, label: "Deep dive", hint: "Derivations, hidden context, harder questions", icon: Telescope },
];

export default function TierToggle({ value, onChange }: { value: ContextTier; onChange: (tier: ContextTier) => void }) {
  return (
    <fieldset>
      <legend className="label">Depth</legend>
      <div role="radiogroup" aria-label="Depth" className="grid grid-cols-2 gap-2">
        {OPTIONS.map(({ value: v, label, hint, icon: Icon }) => {
          const selected = v === value;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(v)}
              className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-subtle"
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className={`size-3.5 ${selected ? "text-accent" : "text-muted"}`} /> {label}
              </span>
              <span className="mt-0.5 block text-xs text-muted">{hint}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
