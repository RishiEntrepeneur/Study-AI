"use client";

import { Check } from "lucide-react";
import { OUTPUTS } from "@/lib/outputs";
import type { OutputType } from "@/lib/types";
import OutputIcon from "./OutputIcon";

interface Props {
  value: OutputType[];
  onChange: (next: OutputType[]) => void;
  /** Outputs that already exist (shown as "regenerate"). */
  existing?: OutputType[];
  compact?: boolean;
}

export default function OutputPicker({ value, onChange, existing = [], compact = false }: Props) {
  const toggle = (type: OutputType) =>
    onChange(value.includes(type) ? value.filter((t) => t !== type) : OUTPUTS.map((o) => o.type).filter((t) => t === type || value.includes(t)));
  const allSelected = value.length === OUTPUTS.length;

  return (
    <fieldset>
      <div className="mb-2 flex items-center justify-between">
        <legend className="label mb-0">What should I create?</legend>
        <button
          type="button"
          onClick={() => onChange(allSelected ? [] : OUTPUTS.map((o) => o.type))}
          className="text-xs font-medium text-accent hover:underline"
        >
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {OUTPUTS.map((o) => {
          const selected = value.includes(o.type);
          return (
            <button
              key={o.type}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => toggle(o.type)}
              className={`flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-subtle"
              }`}
            >
              <span
                className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] border ${
                  selected ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface"
                }`}
              >
                {selected && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <OutputIcon type={o.type} className="size-3.5 text-muted" />
                  {o.label}
                  {existing.includes(o.type) && <span className="text-xs font-normal text-faint">· redo</span>}
                </span>
                {!compact && <span className="mt-0.5 block text-xs leading-snug text-muted">{o.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
