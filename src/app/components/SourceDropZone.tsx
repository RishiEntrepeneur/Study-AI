"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { Captions, FileText, Upload, X } from "lucide-react";
import { ACCEPT_ATTRIBUTE, extractFile, type ExtractedSource } from "@/lib/client/extract";
import Spinner from "./Spinner";

interface Props {
  sources: ExtractedSource[];
  onSourcesChange: (updater: (prev: ExtractedSource[]) => ExtractedSource[]) => void;
  disabled?: boolean;
}

/** Drop or browse for PDF, DOCX, TXT, MD, SRT/VTT or HTML files; text is extracted in the browser. */
export default function SourceDropZone({ sources, onSourcesChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

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
    depth.current = 0;
    setDragging(false);
    if (!disabled) void ingest(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload files"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragging ? "border-accent bg-accent-soft" : "border-line hover:border-faint hover:bg-subtle"
        } ${disabled ? "pointer-events-none opacity-60" : ""}`}
      >
        <Upload className="size-5 text-muted" />
        <p className="mt-2 text-sm font-medium">{dragging ? "Drop to add" : "Drop files here or click to browse"}</p>
        <p className="mt-1 text-xs text-faint">PDF, Word, TXT, Markdown, subtitles (SRT, VTT), HTML</p>
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
        <ul className="space-y-1.5" aria-label="Files">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2 animate-fade-in">
              {s.kind === "transcript" ? <Captions className="size-4 text-muted" /> : <FileText className="size-4 text-muted" />}
              <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
              <span className="text-xs text-faint tabular-nums">{s.words.toLocaleString()} words</span>
              <button
                type="button"
                onClick={() => onSourcesChange((prev) => prev.filter((x) => x.id !== s.id))}
                className="icon-btn size-6"
                aria-label={`Remove ${s.name}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
          {pending.map((name) => (
            <li key={`p-${name}`} className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2 text-sm text-muted">
              <Spinner /> Reading {name}…
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}
