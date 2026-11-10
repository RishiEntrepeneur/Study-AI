"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { KeyTerm } from "@/lib/types";
import MathMarkdown from "./MathMarkdown";

export default function TermsView({ terms }: { terms: KeyTerm[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return terms;
    return terms.filter((t) => t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q));
  }, [query, terms]);

  // Group alphabetically, like a textbook glossary.
  const groups = useMemo(() => {
    const map = new Map<string, KeyTerm[]>();
    for (const t of filtered) {
      const letter = /^[a-z]/i.test(t.term) ? t.term[0].toUpperCase() : "#";
      map.set(letter, [...(map.get(letter) ?? []), t]);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div>
      <div className="relative mb-6 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${terms.length} terms`}
          aria-label="Search terms"
          className="field pl-9"
        />
      </div>
      {groups.length === 0 && <p className="text-muted">No terms match “{query}”.</p>}
      <div className="space-y-8">
        {groups.map(([letter, items]) => (
          <section key={letter} aria-label={letter}>
            <h2 className="mb-2 border-b border-line pb-1 font-serif text-xl text-faint">{letter}</h2>
            <dl className="grid gap-x-10 gap-y-4 md:grid-cols-2">
              {items.map((t) => (
                <div key={t.term} className="min-w-0">
                  <dt className="font-semibold">
                    <MathMarkdown inline>{t.term}</MathMarkdown>
                  </dt>
                  <dd className="mt-0.5 font-serif leading-relaxed text-muted">
                    <MathMarkdown inline>{t.definition}</MathMarkdown>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
