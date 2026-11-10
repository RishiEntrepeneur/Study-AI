"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Captions, ClipboardPaste, FileText, Mic, Plus, Trash2, Upload } from "lucide-react";
import { removeMaterial } from "../actions/library";
import type { ExtractedSource } from "@/lib/client/extract";
import { timeAgo } from "@/lib/format";
import RecordLecture from "./RecordLecture";
import SourceDropZone from "./SourceDropZone";
import Spinner from "./Spinner";

interface MaterialView {
  id: string;
  kind: "text" | "file" | "recording";
  name: string;
  wordCount: number;
  createdAt: number;
  preview: string;
}

type Tab = "paste" | "upload" | "record";

export default function MaterialsPanel({ projectId, materials }: { projectId: string; materials: MaterialView[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<Tab>("paste");
  const [pasted, setPasted] = useState("");
  const [transcript, setTranscript] = useState("");
  const [files, setFiles] = useState<ExtractedSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [open, setOpen] = useState<string | null>(null);

  const save = async () => {
    const items = [
      ...(pasted.trim() ? [{ kind: "text", name: "Pasted text", content: pasted }] : []),
      ...(transcript.trim() ? [{ kind: "recording", name: "Lecture recording", content: transcript }] : []),
      ...files.map((f) => ({ kind: "file", name: f.name, content: f.text })),
    ];
    if (!items.length) return setError("Add some text, a file or a recording first.");
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materials: items }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Couldn't add the material.");
      }
      setPasted("");
      setTranscript("");
      setFiles([]);
      setAdding(false);
      setNotice("Added. Regenerate any outputs above to include it.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const icon = (kind: MaterialView["kind"]) =>
    kind === "recording" ? <Mic className="size-4" /> : kind === "file" ? <FileText className="size-4" /> : <Captions className="size-4" />;

  return (
    <div className="space-y-3">
      {materials.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-line px-4 py-5 text-sm text-muted">
          No material yet. Everything was created from the topic alone. Add notes, a file or a recording to tailor it to your class.
        </p>
      )}
      {materials.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {materials.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-muted">{icon(m.kind)}</span>
                <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} className="min-w-0 flex-1 text-left" aria-expanded={open === m.id}>
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <span className="text-xs text-muted">
                    {m.wordCount.toLocaleString()} words · added {timeAgo(m.createdAt)}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() =>
                    startDelete(async () => {
                      const res = await removeMaterial(projectId, m.id);
                      if (!res.ok) setError(res.error ?? "Couldn't remove it.");
                      router.refresh();
                    })
                  }
                  className="icon-btn hover:text-bad"
                  aria-label={`Remove ${m.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {open === m.id && <p className="mt-2 line-clamp-6 font-serif text-sm leading-relaxed whitespace-pre-line text-muted">{m.preview}</p>}
            </li>
          ))}
        </ul>
      )}

      {notice && !adding && <p className="text-sm text-good">{notice}</p>}

      {adding ? (
        <div className="card space-y-3 p-4">
          <div role="tablist" aria-label="Material type" className="flex gap-1 overflow-x-auto">
            {([
              ["paste", "Paste text", ClipboardPaste],
              ["upload", "Upload files", Upload],
              ["record", "Record lecture", Mic],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${tab === id ? "bg-subtle font-medium" : "text-muted hover:text-ink"}`}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
          {tab === "paste" && (
            <textarea
              aria-label="Material text"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              placeholder="Paste notes, a transcript or a reading…"
              className="field font-serif leading-relaxed"
            />
          )}
          {tab === "upload" && <SourceDropZone sources={files} onSourcesChange={setFiles} disabled={saving} />}
          {tab === "record" && <RecordLecture transcript={transcript} onTranscriptChange={setTranscript} />}
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="btn btn-ghost">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving} className="btn btn-primary">
              {saving && <Spinner />} Add to project
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setNotice(null);
          }}
          className="btn btn-secondary"
        >
          <Plus className="size-4" /> Add material
        </button>
      )}
    </div>
  );
}
