"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Mic, Sparkles, Upload } from "lucide-react";
import type { ExtractedSource } from "@/lib/client/extract";
import { DEFAULT_OUTPUTS } from "@/lib/outputs";
import { countWords, estimateSegments } from "@/lib/text/chunking";
import type { ApiErrorBody, ContextTier, OutputType } from "@/lib/types";
import OutputPicker from "./OutputPicker";
import RecordLecture from "./RecordLecture";
import SourceDropZone from "./SourceDropZone";
import Spinner from "./Spinner";
import TierToggle from "./TierToggle";

interface Props {
  folders: Array<{ id: string; name: string }>;
  defaultFolderId?: string | null;
  /** Smaller layout for the dashboard. */
  compact?: boolean;
  /** How many words of material the AI reads at once (depends on the computer's memory). */
  blockWords?: { trigger: number; size: number };
}

type MaterialTab = "paste" | "upload" | "record";

const TABS: Array<{ id: MaterialTab; label: string; icon: typeof Upload }> = [
  { id: "paste", label: "Paste text", icon: ClipboardPaste },
  { id: "upload", label: "Upload files", icon: Upload },
  { id: "record", label: "Record lecture", icon: Mic },
];

export default function CreateProjectForm({ folders, defaultFolderId = null, compact = false, blockWords }: Props) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [title, setTitle] = useState("");
  const [pasted, setPasted] = useState("");
  const [transcript, setTranscript] = useState("");
  const [files, setFiles] = useState<ExtractedSource[]>([]);
  const [tab, setTab] = useState<MaterialTab>("paste");
  const [showMaterial, setShowMaterial] = useState(!compact);
  const [outputs, setOutputs] = useState<OutputType[]>([...DEFAULT_OUTPUTS]);
  const [tier, setTier] = useState<ContextTier>("standard");
  const [folderId, setFolderId] = useState<string>(defaultFolderId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materialWords = useMemo(
    () => countWords(pasted) + countWords(transcript) + files.reduce((s, f) => s + f.words, 0),
    [pasted, transcript, files],
  );
  const segments = estimateSegments(materialWords, blockWords);
  const hasInput = topic.trim().length > 0 || materialWords >= 20;
  const canSubmit = hasInput && outputs.length > 0 && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setError(
        outputs.length === 0
          ? "Choose at least one thing to create."
          : "Type a topic you want to learn, or add some material (at least 20 words).",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    const materials = [
      ...(pasted.trim() ? [{ kind: "text", name: "Pasted text", content: pasted }] : []),
      ...(transcript.trim() ? [{ kind: "recording", name: "Lecture recording", content: transcript }] : []),
      ...files.map((f) => ({ kind: "file", name: f.name, content: f.text })),
    ];
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, topic, tier, folderId: folderId || null, materials, outputs }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(data?.error ?? `Something went wrong (${res.status}). Please try again.`);
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/projects/${id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't reach the server. Check your connection.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <div>
        <label htmlFor="topic" className="label">
          What do you want to learn?
        </label>
        <textarea
          id="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          maxLength={500}
          rows={compact ? 2 : 3}
          placeholder="e.g. The Krebs cycle for my biochem midterm, or: Explain Fourier transforms intuitively"
          className="field resize-none text-base leading-relaxed"
        />
        <p className="mt-1.5 text-xs text-faint">A topic on its own is enough. Add material below to work from your own lecture.</p>
      </div>

      <div className="rounded-md border border-line">
        <button
          type="button"
          onClick={() => setShowMaterial((v) => !v)}
          aria-expanded={showMaterial}
          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium"
        >
          <span>
            Lecture material <span className="font-normal text-faint">(optional)</span>
          </span>
          <span className="text-xs font-normal text-muted">
            {materialWords > 0 ? `${materialWords.toLocaleString()} words` : showMaterial ? "Hide" : "Add"}
          </span>
        </button>
        {showMaterial && (
          <div className="border-t border-line p-3">
            <div role="tablist" aria-label="Material type" className="mb-3 flex gap-1 overflow-x-auto">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    tab === id ? "bg-subtle font-medium text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
            {tab === "paste" && (
              <textarea
                aria-label="Pasted material"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={7}
                placeholder="Paste lecture notes, a transcript, or a textbook section…"
                className="field font-serif leading-relaxed"
              />
            )}
            {tab === "upload" && <SourceDropZone sources={files} onSourcesChange={setFiles} disabled={submitting} />}
            {tab === "record" && <RecordLecture transcript={transcript} onTranscriptChange={setTranscript} />}
            {segments > 1 && (
              <p className="mt-3 text-xs text-muted">
                Long material: the AI will read it in {segments} parts of about {(blockWords?.size ?? 8000).toLocaleString()} words, then
                combine them. Notes come first; everything else is made from the notes, which is much quicker.
              </p>
            )}
          </div>
        )}
      </div>

      <OutputPicker value={outputs} onChange={setOutputs} compact={compact} />

      <div className={`grid gap-6 ${compact ? "" : "md:grid-cols-2"}`}>
        <TierToggle value={tier} onChange={setTier} />
        <div className="space-y-4">
          <div>
            <label htmlFor="folder" className="label">
              Folder
            </label>
            <select id="folder" value={folderId} onChange={(e) => setFolderId(e.target.value)} className="field">
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          {!compact && (
            <div>
              <label htmlFor="title" className="label">
                Title <span className="font-normal text-faint">(optional)</span>
              </label>
              <input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="We'll name it from your topic"
                className="field"
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={submitting} className="btn btn-primary px-5 py-2.5">
          {submitting ? <Spinner /> : <Sparkles className="size-4" />}
          {submitting ? "Creating…" : `Create ${outputs.length === 1 ? "1 item" : `${outputs.length} items`}`}
        </button>
        {!hasInput && <span className="text-sm text-faint">Add a topic or some material to start.</span>}
      </div>
    </form>
  );
}
