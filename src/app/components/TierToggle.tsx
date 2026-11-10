"use client";

import { useRef, type KeyboardEvent } from "react";
import { Check, Telescope, Zap, type LucideIcon } from "lucide-react";
import type { ContextTier } from "@/lib/types";

interface TierOption {
  value: ContextTier;
  label: string;
  tagline: string;
  icon: LucideIcon;
  features: string[];
}

const OPTIONS: TierOption[] = [
  {
    value: "standard",
    label: "Standard",
    tagline: "Fast, exam-ready mastery",
    icon: Zap,
    features: ["Concept architecture with blind spots", "10–15 flashcards · 6–8 quiz questions", "Fastest turnaround"],
  },
  {
    value: "deep_dive",
    label: "Deep Dive",
    tagline: "Active research protocol",
    icon: Telescope,
    features: [
      "Formal definitions & hidden context",
      "Step-by-step math derivations",
      "15–25 flashcards · 8–12 quiz questions",
    ],
  },
];

interface TierToggleProps {
  value: ContextTier;
  onChange: (tier: ContextTier) => void;
  disabled?: boolean;
}

export default function TierToggle({ value, onChange, disabled }: TierToggleProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = OPTIONS.findIndex((o) => o.value === value);
  const active = OPTIONS[activeIndex];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = (activeIndex + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + OPTIONS.length) % OPTIONS.length;
    onChange(OPTIONS[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Analytical tier"
        onKeyDown={onKeyDown}
        className="relative grid grid-cols-2 rounded-2xl border border-white/10 bg-black/30 p-1"
      >
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl bg-gradient-to-br from-violet-500/90 via-fuchsia-500/80 to-indigo-500/90 shadow-[0_8px_30px_-8px_rgba(168,85,247,0.7)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
        />
        {OPTIONS.map((option, i) => {
          const Icon = option.icon;
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`relative z-10 flex flex-col items-center gap-0.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed ${
                selected ? "text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Icon className="size-4" aria-hidden />
                {option.label}
              </span>
              <span className={`text-[11px] font-normal ${selected ? "text-white/80" : "text-zinc-500"}`}>{option.tagline}</span>
            </button>
          );
        })}
      </div>

      <ul key={active.value} className="mt-4 space-y-2 animate-fade-up">
        {active.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-zinc-300">
            <Check className="mt-0.5 size-4 shrink-0 text-violet-300" aria-hidden />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}
