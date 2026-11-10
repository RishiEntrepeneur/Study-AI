import { BookA, BookOpen, Layers, ListChecks, Network, ScrollText, type LucideIcon } from "lucide-react";
import type { OutputType } from "@/lib/types";

export const OUTPUT_ICONS: Record<OutputType, LucideIcon> = {
  notes: BookOpen,
  cheatsheet: ScrollText,
  flashcards: Layers,
  quiz: ListChecks,
  mindmap: Network,
  terms: BookA,
};

export default function OutputIcon({ type, className = "size-4" }: { type: OutputType; className?: string }) {
  const Icon = OUTPUT_ICONS[type];
  return <Icon className={className} aria-hidden />;
}
