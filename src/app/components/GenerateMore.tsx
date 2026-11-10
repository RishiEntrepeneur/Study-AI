"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import type { OutputType } from "@/lib/types";
import { useGenerations } from "./GenerationProvider";
import OutputPicker from "./OutputPicker";
import Spinner from "./Spinner";

export default function GenerateMore() {
  const { statuses, generate } = useGenerations();
  const existing = statuses.filter((s) => s.hasContent).map((s) => s.type);
  const [selected, setSelected] = useState<OutputType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const replacesCards = selected.includes("flashcards") && existing.includes("flashcards");

  return (
    <div className="space-y-4">
      <OutputPicker value={selected} onChange={setSelected} existing={existing} compact />
      {replacesCards && <p className="text-sm text-warn">Regenerating flashcards replaces your current cards and their review progress.</p>}
      {error && <p className="text-sm text-bad">{error}</p>}
      <button
        type="button"
        disabled={pending || selected.length === 0}
        onClick={() =>
          start(async () => {
            const err = await generate(selected);
            setError(err);
            if (!err) setSelected([]);
          })
        }
        className="btn btn-primary"
      >
        {pending ? <Spinner /> : <Sparkles className="size-4" />}
        {selected.length ? `Create ${selected.length} item${selected.length === 1 ? "" : "s"}` : "Choose what to create"}
      </button>
    </div>
  );
}
