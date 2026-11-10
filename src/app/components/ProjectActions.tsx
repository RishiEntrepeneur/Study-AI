"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, Pencil, Trash2 } from "lucide-react";
import { moveProject, removeProject, renameProject } from "../actions/library";
import Dialog from "./Dialog";
import Spinner from "./Spinner";

interface Props {
  project: { id: string; title: string; folderId: string | null };
  folders: Array<{ id: string; name: string }>;
}

export default function ProjectActions({ project, folders }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"rename" | "move" | "delete" | null>(null);
  const [title, setTitle] = useState(project.title);
  const [folderId, setFolderId] = useState(project.folderId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    setDialog(null);
    setError(null);
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string } | undefined | void>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res && !res.ok) return setError(res.error ?? "Something went wrong.");
      close();
      router.refresh();
    });

  return (
    <div className="flex shrink-0 gap-1">
      <button type="button" className="icon-btn" title="Rename" aria-label="Rename project" onClick={() => setDialog("rename")}>
        <Pencil className="size-4" />
      </button>
      <button type="button" className="icon-btn" title="Move to folder" aria-label="Move to folder" onClick={() => setDialog("move")}>
        <FolderInput className="size-4" />
      </button>
      <button type="button" className="icon-btn hover:text-bad" title="Delete" aria-label="Delete project" onClick={() => setDialog("delete")}>
        <Trash2 className="size-4" />
      </button>

      <Dialog open={dialog === "rename"} onClose={close} title="Rename project">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => renameProject(project.id, title));
          }}
          className="space-y-4"
        >
          <input aria-label="Title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="field" />
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={pending || !title.trim()} className="btn btn-primary">
              {pending && <Spinner />} Save
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === "move"} onClose={close} title="Move to folder">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => moveProject(project.id, folderId || null));
          }}
          className="space-y-4"
        >
          <select aria-label="Folder" value={folderId} onChange={(e) => setFolderId(e.target.value)} className="field">
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {folders.length === 0 && <p className="text-sm text-muted">You don&apos;t have any folders yet. Create one from the sidebar.</p>}
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending && <Spinner />} Move
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === "delete"} onClose={close} title={`Delete “${project.title}”?`} description="This removes its materials, notes, flashcards, quiz history and chat. It can't be undone.">
        {error && <p className="mb-3 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="btn btn-ghost">
            Cancel
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => removeProject(project.id))} className="btn btn-danger">
            {pending && <Spinner />} Delete project
          </button>
        </div>
      </Dialog>
    </div>
  );
}
