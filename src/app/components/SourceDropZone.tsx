"use client";

import { useCallback, useId, useRef, useState, type DragEvent } from "react";
import { Captions, ClipboardPaste, CloudUpload, FileText, LoaderCircle, Trash2, X } from "lucide-react";
import { ACCEPT_ATTRIBUTE, extractFile, type ExtractedSource } from "@/lib/client/extract";
import { countWords } from "@/lib/text/chunking";

interface SourceDropZoneProps {
  sources: ExtractedSource[];
  onSourcesChange: (updater: (prev: ExtractedSource[]) => ExtractedSource[]) => void;
  pastedText: string;
  onPastedTextChange: (text: string) => void;
  disabled?: boolean;
}

const KIND_LABEL: Record<ExtractedSource["kind"], string> = {
  pdf: "PDF",
  docx: "DOCX",
  transcript: "Transcript",
  html: "Web page",
  text: "Text",
};

export default function SourceDropZone({
  sources,
  onSourcesChange,
  pastedText,
  onPastedTextChange,
  disabled,
}: SourceDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const textareaId = useId();

  const ingest = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setErrors([]);
      setPending((p) => [...p, ...files.map((f) => f.name)]);
      const results = await Promise.allSettled(files.map(extractFile));
      const added: ExtractedSource[] = [];
      const failed: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") added.push(r.value);
        else failed.push(r.reason instanceof Error ? r.reason.message : `${files[i].name}: could not be read.`);
      });
      onSourcesChange((prev) => {
        const ids = new Set(prev.map((s) => s.id));
        return [...prev, ...added.filter((s) => !ids.has(s.id))];
      });
      setErrors(failed);
      setPending((p) => p.filter((name) => !files.some((f) => f.name === name)));
    },
    [onSourcesChange],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      void ingest(files);
      return;
    }
    const text = e.dataTransfer.getData("text/plain");
    if (text) onPastedTextChange(pastedText ? `${pastedText}\n\n${text}` : text);
  };

  const pastedWords = countWords(pastedText);

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload lecture files"
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${
          dragging
            ? "scale-[1.01] border-violet-400 bg-violet-500/10 shadow-[0_0_60px_-10px_rgba(139,92,246,0.6)]"
            : "border-white/15 bg-white/[0.02] hover:border-violet-400/50 hover:bg-violet-500/[0.04]"
        } ${disabled ? "pointer-events-none opacity-60" : ""}`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_12rem_at_50%_0%,rgba(139,92,246,0.18),transparent)] opacity-0 transition-opacity group-hover:opacity-100"
        />
        <div className="relative mb-4 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-cyan-500/20 ring-1 ring-white/15">
          <CloudUpload className={`size-7 text-violet-200 transition-transform ${dragging ? "-translate-y-1" : ""}`} />
        </div>
        <p className="relative text-base font-semibold text-white">
          {dragging ? "Release to load your material" : "Drop lecture files here"}
        </p>
        <p className="relative mt-1 text-sm text-zinc-400">
          Transcripts, notes & documents · or <span className="text-violet-300 underline-offset-2 group-hover:underline">browse files</span>
        </p>
        <div className="relative mt-4 flex flex-wrap justify-center gap-1.5">
          {["PDF", "DOCX", "TXT", "MD", "SRT", "VTT", "HTML"].map((ext) => (
            <span key={ext} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
              {ext}
            </span>
          ))}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(e) => {
            void ingest(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {(sources.length > 0 || pending.length > 0) && (
        <ul className="space-y-2" aria-label="Loaded sources">
          {sources.map((source) => (
            <li
              key={source.id}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 animate-fade-up"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-200">
                {source.kind === "transcript" ? <Captions className="size-4" /> : <FileText className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">{source.name}</p>
                <p className="text-xs text-zinc-400">
                  {KIND_LABEL[source.kind]} · {source.words.toLocaleString()} words
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSourcesChange((prev) => prev.filter((s) => s.id !== source.id))}
                disabled={disabled}
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                aria-label={`Remove ${source.name}`}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
          {pending.map((name) => (
            <li key={`pending-${name}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <LoaderCircle className="size-4 animate-spin text-violet-300" />
              <span className="truncate text-sm text-zinc-300">Extracting text from {name}…</span>
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <div role="alert" className="space-y-1 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-black/30 focus-within:border-violet-400/60 focus-within:ring-4 focus-within:ring-violet-500/10">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
          <label htmlFor={textareaId} className="flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">
            <ClipboardPaste className="size-3.5" /> Paste raw text
          </label>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{pastedWords.toLocaleString()} words</span>
            {pastedText && (
              <button
                type="button"
                onClick={() => onPastedTextChange("")}
                disabled={disabled}
                className="flex items-center gap-1 text-zinc-400 transition hover:text-rose-300"
              >
                <Trash2 className="size-3.5" /> Clear
              </button>
            )}
          </div>
        </div>
        <textarea
          id={textareaId}
          value={pastedText}
          onChange={(e) => onPastedTextChange(e.target.value)}
          disabled={disabled}
          rows={8}
          spellCheck={false}
          placeholder="Paste a lecture transcript, your raw notes, a textbook chapter… Massive inputs are fine: anything over 15,000 words is automatically split into chronological 8,000-word segments."
          className="block max-h-[420px] min-h-40 w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-zinc-200 placeholder:font-sans placeholder:text-zinc-500 focus:outline-none"
        />
      </div>
    </div>
  );
}
